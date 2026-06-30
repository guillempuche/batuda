import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import {
	type CreateResearchInput,
	ResearchService,
	type SystemDefaults,
} from '@batuda/research'

import { EnvVars } from '../../lib/env'
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

// ── start_research (async) ──

const StartResearch = Tool.make('start_research', {
	description:
		"Start a research run; returns {_tag:'started', id, status, applied_instructions} immediately — poll get_research for results. applied_instructions lists the instruction templates that shaped the run. The user's default research instructions apply automatically; pass `instructions` (template names or ids) to override them for this run. An unknown or ambiguous name returns {_tag:'instruction_clarification'} with candidates instead of starting. If the user states a new standing preference, save it with manage_instruction_template.",
	parameters: Schema.Struct({
		query: ResearchQuery,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(SchemaNameParam),
		instructions: Schema.optional(InstructionsOverride),
	}),
	success: Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal('started'),
			id: Schema.String,
			status: Schema.String,
			applied_instructions: Schema.Array(Schema.String),
		}),
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
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Research')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

// ── research_sync (blocking) ──

const ResearchSync = Tool.make('research_sync', {
	description:
		"Run research to completion and return full findings inline (blocks until done or timeout); best for short research. The returned run includes applied_instructions — the instruction templates that shaped it. The user's default research instructions apply automatically; pass `instructions` (template names or ids) to override them for this run. An unknown or ambiguous name returns {_tag:'instruction_clarification'} with candidates instead of running.",
	parameters: Schema.Struct({
		query: ResearchQuery,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(SchemaNameParam),
		instructions: Schema.optional(InstructionsOverride),
		max_wait_seconds: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
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
// svc.get returns the persisted column as `templateNames` (PgClient camelCases
// result keys); normalize it to applied_instructions so sync/poll callers read
// the same shape start_research returns.
const withAppliedInstructions = (run: unknown): unknown => {
	if (run === null || typeof run !== 'object') return run
	const row = run as Record<string, unknown>
	const names = row['templateNames'] ?? row['template_names']
	return {
		...row,
		applied_instructions: Array.isArray(names) ? names : [],
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
						},
						systemDefaults,
						resolved.instructions,
					)
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
					const orgId = (yield* CurrentOrg).id
					const resolved = yield* resolveForRun(
						orgId,
						userId,
						params.instructions ?? [],
					)
					if (!resolved.ok) return resolved.clarification
					const { id } = yield* svc.create(
						userId,
						orgId,
						{
							query: params.query,
							context: params.context as CreateResearchInput['context'],
							schemaName: params.schema_name,
						},
						systemDefaults,
						resolved.instructions,
					)

					// Poll until the run reaches a terminal status or we exceed
					// the caller's timeout (default 2 minutes).
					const maxWaitMs = (params.max_wait_seconds ?? 120) * 1000
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
