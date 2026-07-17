import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import {
	CurrentOrg,
	ResearchRunDetail,
	SessionContext,
} from '@batuda/controllers'
import {
	type CreateResearchInput,
	ResearchService,
	type SystemDefaults,
} from '@batuda/research'

import { EnvVars } from '../../lib/env'
import { detachFromTransaction, enterOrgScope } from '../../middleware/org'
import {
	InstructionClarification,
	InstructionsOverride,
	resolveInstructionOverride,
} from './_instructions-shared'
import {
	ResearchQuery,
	redactDbErrors,
	SchemaNameParam,
	Uuid,
} from './_research-shared'

const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]

// The longest research_sync will block for findings before handing back a
// still-running run to poll. Held under the MCP transport's ~1-minute hard cap
// on a blocking call, so a longer wait would error instead of returning.
const RESEARCH_SYNC_MAX_WAIT_SECONDS = 45

// A run plus `applied_instructions` (the instruction templates that shaped it).
// Dates encode to ISO strings via ResearchRunDetail.
const RunWithInstructions = Schema.Struct({
	...ResearchRunDetail.fields,
	applied_instructions: Schema.Array(Schema.String),
})
const NotFoundResult = Schema.Struct({ error: Schema.String })

// An unconfirmed selector fan-out: how many companies matched and the paid-data
// ceiling summed across them, so the caller can re-submit with confirm:true (or
// narrow the filter) before one run per company launches.
const ConfirmRequired = Schema.Struct({
	_tag: Schema.Literal('confirm_required'),
	subject_count: Schema.Number,
	estimated_cost_cents: Schema.Number,
})

// get_research: the found run, or a not-found marker.
const GetResearchResult = Schema.Union([RunWithInstructions, NotFoundResult])

// research_sync: the found run, a not-found marker, the fan-out cost gate, or an
// instruction clarification when a passed instruction name can't be resolved
// (the run never starts in the last two cases).
const ResearchSyncResult = Schema.Union([
	RunWithInstructions,
	NotFoundResult,
	ConfirmRequired,
	InstructionClarification,
])

// ── start_research (async) ──

const StartResearch = Tool.make('start_research', {
	description:
		"Start a research run; returns {_tag:'started', id, status, applied_instructions} immediately — poll get_research for results. applied_instructions lists the instruction templates that shaped the run. The user's default research instructions apply automatically; pass `instructions` (template names or ids) to override them for this run. An unknown or ambiguous name returns {_tag:'instruction_clarification'} with candidates instead of starting. A `context.selector` researches every matching company (one run each); without `confirm:true` it returns {_tag:'confirm_required', subject_count, estimated_cost_cents} first so you can preview the scale — re-submit with confirm:true to launch (or narrow the filter). If the user states a new standing preference, save it with manage_instruction_template.",
	parameters: Schema.Struct({
		query: ResearchQuery,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(SchemaNameParam),
		instructions: Schema.optional(InstructionsOverride),
		confirm: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal('started'),
			id: Schema.String,
			status: Schema.String,
			applied_instructions: Schema.Array(Schema.String),
		}),
		ConfirmRequired,
		InstructionClarification,
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Start Research')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── get_research ──

const GetResearch = Tool.make('get_research', {
	description:
		'Get the current state of a research run. Returns status, findings (if complete), cost, sources, and applied_instructions — the instruction templates that shaped the run.',
	parameters: Schema.Struct({
		id: Uuid,
	}),
	success: GetResearchResult,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Research')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── research_sync (blocking) ──

const ResearchSync = Tool.make('research_sync', {
	description:
		"Run research and return full findings inline when it finishes quickly; best for short or cached research. Blocks up to ~45s (the transport's limit): a short/cached run returns completed findings; a longer one returns the run still 'running' for you to poll get_research — the run keeps going regardless and is never lost. The returned run includes applied_instructions — the instruction templates that shaped it. The user's default research instructions apply automatically; pass `instructions` (template names or ids) to override them for this run. An unknown or ambiguous name returns {_tag:'instruction_clarification'} with candidates instead of running. A `context.selector` fans out one run per matching company; without `confirm:true` it returns {_tag:'confirm_required', subject_count, estimated_cost_cents} first.",
	parameters: Schema.Struct({
		query: ResearchQuery,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(SchemaNameParam),
		instructions: Schema.optional(InstructionsOverride),
		max_wait_seconds: Schema.optional(Schema.Number),
		confirm: Schema.optional(Schema.Boolean),
	}),
	success: ResearchSyncResult,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Research (Sync)')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Toolkit + handlers ──

export const ResearchMcpTools = Toolkit.make(
	StartResearch,
	GetResearch,
	ResearchSync,
)

// Surface the instruction templates a run applied under one consistent field.
// The run carries the persisted `templateNames` (jsonb, so typed Unknown);
// normalize it to applied_instructions so sync/poll callers read the same shape
// start_research returns.
const withAppliedInstructions = (run: typeof ResearchRunDetail.Type) => {
	const names = run.templateNames
	return {
		...run,
		applied_instructions: Array.isArray(names)
			? names.filter((name): name is string => typeof name === 'string')
			: [],
	}
}

export const ResearchMcpHandlersLive = ResearchMcpTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* ResearchService
		const sql = yield* SqlClient.SqlClient
		const env = yield* EnvVars

		const systemDefaults: SystemDefaults = {
			budgetCents: env.RESEARCH_DEFAULT_BUDGET_CENTS,
			paidBudgetCents: env.RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
			autoApprovePaidCents: env.RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
			paidMonthlyCapCents: env.RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
			hardCeiling: env.RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
		}

		// Resolve a per-run override (names or ids) to the effective instruction
		// stack, or a clarification to hand straight back when a name can't resolve.
		const resolveForRun = (
			orgId: string,
			userId: string,
			refs: ReadonlyArray<string>,
		) =>
			resolveInstructionOverride({
				sql,
				organizationId: orgId,
				userId,
				agent: 'research',
				refs,
			})

		return {
			start_research: params =>
				Effect.gen(function* () {
					// Run as the attributed user (the api key's owner), not a shared
					// system actor — so the cache key, budget, and created_by all
					// belong to the real person behind the key.
					const userId = (yield* SessionContext).userId
					const orgId = (yield* CurrentOrg).id
					const resolved = yield* resolveForRun(
						orgId,
						userId,
						params.instructions ?? [],
					)
					if (!resolved.ok) return resolved.clarification
					const result = yield* svc.create(
						userId,
						orgId,
						{
							query: params.query,
							context: params.context as CreateResearchInput['context'],
							schemaName: params.schema_name,
							// Default off: a selector that matches companies bounces with
							// the matched count so the caller can preview the scale before
							// one (potentially paid) run per company launches.
							confirm: params.confirm ?? false,
						},
						systemDefaults,
						resolved.instructions,
					)
					if (result.status === 'confirm_required') {
						return {
							_tag: 'confirm_required' as const,
							subject_count: result.subjectCount,
							estimated_cost_cents: result.estimatedCostCents,
						}
					}
					return {
						_tag: 'started' as const,
						id: result.id,
						status: result.status,
						applied_instructions: resolved.instructions.templateNames,
					}
				}).pipe(redactDbErrors),

			get_research: params =>
				Effect.gen(function* () {
					const run = yield* svc.get(params.id)
					return run ? withAppliedInstructions(run) : { error: 'not found' }
				}).pipe(redactDbErrors),

			research_sync: params =>
				Effect.gen(function* () {
					const userId = (yield* SessionContext).userId
					const org = yield* CurrentOrg
					const resolved = yield* resolveForRun(
						org.id,
						userId,
						params.instructions ?? [],
					)
					if (!resolved.ok) return resolved.clarification

					// Create the run in its OWN top-level transaction on a fresh
					// pooled connection, detached from this request's transaction.
					// The whole MCP request runs inside one transaction that commits
					// only when the handler returns — but the poll below holds it open
					// for up to ~45s. Without detaching, the run row would stay
					// uncommitted the whole time: invisible to the dispatch worker
					// (which runs the job on its own connection, so it never leaves the
					// queue), and rolled back outright if a client/transport timeout
					// interrupts the handler — silently losing the run. Committing it
					// here makes it durable and pollable the instant create() returns.
					const created = yield* svc
						.create(
							userId,
							org.id,
							{
								query: params.query,
								context: params.context as CreateResearchInput['context'],
								schemaName: params.schema_name,
								confirm: params.confirm ?? false,
							},
							systemDefaults,
							resolved.instructions,
						)
						.pipe(
							enterOrgScope(sql, { org, userId }),
							detachFromTransaction(sql),
						)
					if (created.status === 'confirm_required') {
						return {
							_tag: 'confirm_required' as const,
							subject_count: created.subjectCount,
							estimated_cost_cents: created.estimatedCostCents,
						}
					}
					const { id } = created

					// Block for the findings, but only up to a transport-safe bound:
					// a blocking MCP call is hard-capped near a minute, and real
					// enrichment runs outlast that, so a longer wait would just error.
					// A short/cached run returns findings inline; a longer one comes
					// back still 'running' for the caller to poll. The poll reads the
					// worker's committed progress on this request's connection.
					const maxWaitMs =
						Math.min(
							params.max_wait_seconds ?? RESEARCH_SYNC_MAX_WAIT_SECONDS,
							RESEARCH_SYNC_MAX_WAIT_SECONDS,
						) * 1000
					const startedAt = Date.now()

					let run = yield* svc.get(id)
					while (
						run &&
						['queued', 'running'].includes(
							(run as { status: string }).status,
						) &&
						Date.now() - startedAt < maxWaitMs
					) {
						yield* Effect.sleep('2 seconds')
						run = yield* svc.get(id)
					}

					return run ? withAppliedInstructions(run) : { error: 'not found' }
				}).pipe(redactDbErrors),
		}
	}),
)
