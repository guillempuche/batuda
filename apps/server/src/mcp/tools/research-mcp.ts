import { Effect, Result, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import {
	ContextInput,
	CurrentOrg,
	ResearchRunDetail,
	SessionContext,
} from '@batuda/controllers'
import { isActiveResearchStatus } from '@batuda/domain'
import {
	type CreateResearchInput,
	ResearchService,
	type SubjectUnavailable,
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
	MaxWaitSeconds,
	pollAfterMs,
	ResearchQuery,
	redactDbErrors,
	SchemaNameParam,
	Uuid,
} from './_research-shared'

const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]

// The longest research_sync waits for findings before handing back a
// still-running run to check on. Only an answer already in the cache arrives
// inside it — fresh research takes minutes — so a longer wait buys nothing and
// holds a database connection open meanwhile. Nothing caps this from the
// outside either: each client sets its own timeout, some only a few seconds.
const RESEARCH_SYNC_MAX_WAIT_SECONDS = 10

// A run plus `applied_instructions` (the instruction templates that shaped it).
// Dates encode to ISO strings via ResearchRunDetail. `instructionSegments` is
// overridden to optional so it can be dropped from the response by default: it
// repeats the full instruction-template text (~9k chars) on every fetch, and
// templateNames + templateFingerprint already identify the stack.
const RunWithInstructions = Schema.Struct({
	...ResearchRunDetail.fields,
	instructionSegments: Schema.optional(Schema.Unknown),
	applied_instructions: Schema.Array(Schema.String),
	// Absent once the run has ended, which is how a caller knows to stop asking.
	poll_after_ms: Schema.optional(Schema.Number),
})
const NotFoundResult = Schema.Struct({ error: Schema.String })

// A caller passed a `context` that doesn't match the expected shape (most often a
// selector without its `filter` wrapper). Returned instead of letting the bad
// value reach the engine, where reading `selector.filter.status` on the wrong
// shape used to crash the run.
const InvalidContext = Schema.Struct({
	_tag: Schema.Literal('invalid_context'),
	error: Schema.String,
})

// A run was pinned to a record this organization cannot see. Named as its own
// answer rather than an error so the model is told which id was refused and can
// say so, instead of reporting that research failed for some unstated reason.
const SubjectNotFound = Schema.Struct({
	_tag: Schema.Literal('subject_not_found'),
	subjects: Schema.Array(
		Schema.Struct({ table: Schema.String, id: Schema.String }),
	),
	error: Schema.String,
})

// "You cannot have that record" is handed back as an answer the model can
// relay, not a failure. Caught before redactDbErrors so that keeps meeting only
// the SqlError it is written for.
//
// An id that is not this organization's reads exactly like one that was never
// there, and the wording covers both without saying which — telling them apart
// would confirm that somebody else holds it.
const subjectRefusal = (e: SubjectUnavailable) =>
	Effect.succeed({
		_tag: 'subject_not_found' as const,
		subjects: e.subjects,
		error: `No ${e.subjects.length === 1 ? 'record was' : 'records were'} found here for ${e.subjects
			.map(s => `${s.table} ${s.id}`)
			.join(', ')}. Check the id, or search for the company by name first.`,
	})

const decodeContext = Schema.decodeUnknownEffect(ContextInput)

// The exact shape a caller's `context` must take, spelled out in the rejection so
// an agent can correct the call without reading the source.
const CONTEXT_SHAPE_HINT =
	'Expected context = { subjects?: [{ table, id }], selector?: { table: "companies", filter: { status?, industry?, country?, tags? } }, hints?: { language?, recency_days?, location?, min_employees?, max_employees? } }.'

const describeContextError = (error: unknown): string => {
	const detail = error instanceof Error ? error.message : String(error)
	return `Invalid context. ${CONTEXT_SHAPE_HINT} ${detail}`
}

// Validate a caller's `context` (absent is valid) and fold a decode failure into
// a tagged result the handler can return directly. The decode is the same one the
// HTTP route runs, so both entry points reject a malformed selector the same way.
const readContext = (raw: unknown) =>
	Effect.gen(function* () {
		if (raw === undefined) return { ok: true as const, value: undefined }
		const decoded = yield* Effect.result(decodeContext(raw))
		return Result.isFailure(decoded)
			? { ok: false as const, error: describeContextError(decoded.failure) }
			: { ok: true as const, value: decoded.success }
	})

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
	InvalidContext,
	SubjectNotFound,
])

// ── start_research (async) ──

const StartResearch = Tool.make('start_research', {
	description:
		"Start a research run; returns {_tag:'started', id, status, applied_instructions, poll_after_ms?} immediately — then call get_research for results. Fresh research takes 2-5 minutes, so status comes back 'queued' and poll_after_ms says how many milliseconds to wait before the first check; unless the same question was answered before, in which case status is already 'succeeded' and poll_after_ms is absent, meaning the findings are ready and there is nothing to wait for. applied_instructions lists the instruction templates that shaped the run. The user's default research instructions apply automatically; pass `stack` (a named stack, by name or id) to run a specific saved stack, and/or `instructions` (template names or ids) to layer extra templates after it for this run. An unknown or ambiguous `stack`/`instructions` ref returns {_tag:'instruction_clarification'} with candidates instead of starting. A `context.selector` — shaped `{ table: \"companies\", filter: { status?, industry?, country?, tags? } }` — researches every matching company (one run each); without `confirm:true` it returns {_tag:'confirm_required', subject_count, estimated_cost_cents} first so you can preview the scale — re-submit with confirm:true to launch (or narrow the filter). A malformed context returns {_tag:'invalid_context', error} without starting a run. If the user states a new standing preference, save it with manage_instructions.",
	parameters: Schema.Struct({
		query: ResearchQuery,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(SchemaNameParam),
		stack: Schema.optional(Schema.String),
		instructions: Schema.optional(InstructionsOverride),
		confirm: Schema.optional(Schema.Boolean),
	}),
	success: Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal('started'),
			id: Schema.String,
			status: Schema.String,
			applied_instructions: Schema.Array(Schema.String),
			// Absent when the answer came straight from the cache, since there is
			// nothing left to wait for.
			poll_after_ms: Schema.optional(Schema.Number),
		}),
		ConfirmRequired,
		InstructionClarification,
		InvalidContext,
		SubjectNotFound,
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Start Research')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── get_research ──

const GetResearch = Tool.make('get_research', {
	description:
		"Get the current state of a research run. Returns status, progressSteps, poll_after_ms, findings (if complete), cost, sources, and applied_instructions — the instruction templates that shaped the run. progressSteps counts the rounds of work the run has got through: null until the first round finishes, then climbing every 20-30 seconds while it works. Null or unchanged across two or three polls is normal; unchanged for several minutes means the run is stuck rather than slow, and cancel_research ends it. poll_after_ms is how many milliseconds to wait before calling this again; it is absent once the run has ended, which means stop calling. The full instruction-template text is omitted by default to keep the response small; pass include:['instruction_segments'] to get it back.",
	parameters: Schema.Struct({
		id: Uuid,
		// Opt back into heavy fields dropped by default. Only the full instruction
		// text qualifies today; kept as a list so more can join without a shape change.
		include: Schema.optional(
			Schema.Array(Schema.Literals(['instruction_segments'])),
		),
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
		"Run research and return full findings inline when it finishes quickly; best for a question likely asked before, since only a cached answer comes back inline. Waits up to ~10s: a cached run returns completed findings; anything else returns the run still going — status 'queued' or 'running' — with poll_after_ms, for you to call get_research after that many milliseconds. The run keeps going regardless and is never lost. Prefer start_research when you expect fresh research: a real run takes 2-5 minutes and will never finish inside this wait, so expect no findings and a null progressSteps here. Pass max_wait_seconds (whole seconds, 1-10; larger values are treated as 10) to wait less if your own request timeout is shorter. The returned run includes applied_instructions — the instruction templates that shaped it. The user's default research instructions apply automatically; pass `stack` (a named stack, by name or id) to run a specific saved stack, and/or `instructions` (template names or ids) to layer extra templates after it for this run. An unknown or ambiguous `stack`/`instructions` ref returns {_tag:'instruction_clarification'} with candidates instead of running. A `context.selector` — shaped `{ table: \"companies\", filter: { status?, industry?, country?, tags? } }` — fans out one run per matching company; without `confirm:true` it returns {_tag:'confirm_required', subject_count, estimated_cost_cents} first. A malformed context returns {_tag:'invalid_context', error} without starting a run.",
	parameters: Schema.Struct({
		query: ResearchQuery,
		context: Schema.optional(Schema.Unknown),
		schema_name: Schema.optional(SchemaNameParam),
		stack: Schema.optional(Schema.String),
		instructions: Schema.optional(InstructionsOverride),
		max_wait_seconds: Schema.optional(MaxWaitSeconds),
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
// start_research returns. The full instruction text (`instructionSegments`) is
// dropped unless the caller opted back in — it is ~9k chars repeated on every
// fetch and templateNames + templateFingerprint already identify the stack.
const withAppliedInstructions = (
	run: typeof ResearchRunDetail.Type,
	includeSegments = false,
) => {
	const names = run.templateNames
	const nextPoll = pollAfterMs(run.status)
	const withInstructions = {
		...run,
		applied_instructions: Array.isArray(names)
			? names.filter((name): name is string => typeof name === 'string')
			: [],
		// Left off a run that has ended rather than sent as zero: a missing field
		// reads as "nothing more is coming" without inviting one last check.
		...(nextPoll === undefined ? {} : { poll_after_ms: nextPoll }),
	}
	if (includeSegments) return withInstructions
	// Drop the heavy instruction text while keeping the run's typed shape — cast
	// only the delete operand, so the returned object stays fully typed.
	const trimmed = { ...withInstructions }
	delete (trimmed as { instructionSegments?: unknown }).instructionSegments
	return trimmed
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

		// Resolve a per-run override (an optional named stack, plus template names
		// or ids) to the effective instruction stack, or a clarification to hand
		// straight back when a ref can't resolve.
		const resolveForRun = (
			orgId: string,
			userId: string,
			refs: ReadonlyArray<string>,
			stackRef: string | undefined,
		) =>
			resolveInstructionOverride({
				sql,
				organizationId: orgId,
				userId,
				agent: 'research',
				refs,
				stackRef,
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
						params.stack,
					)
					if (!resolved.ok) return resolved.clarification
					const context = yield* readContext(params.context)
					if (!context.ok) {
						return { _tag: 'invalid_context' as const, error: context.error }
					}
					const result = yield* svc.create(
						userId,
						orgId,
						{
							query: params.query,
							context: context.value as CreateResearchInput['context'],
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
					// Read from the status the run really came back with, not assumed to
					// be queued: a repeat question answers from the cache and arrives
					// already finished, with nothing left to check on.
					const nextPoll = pollAfterMs(result.status)
					return {
						_tag: 'started' as const,
						id: result.id,
						status: result.status,
						applied_instructions: resolved.instructions.templateNames,
						...(nextPoll === undefined ? {} : { poll_after_ms: nextPoll }),
					}
				})
					.pipe(Effect.catchTag('SubjectUnavailable', subjectRefusal))
					.pipe(redactDbErrors),

			get_research: params =>
				Effect.gen(function* () {
					const run = yield* svc.get(params.id)
					if (!run) return { error: 'not found' }
					const includeSegments = (params.include ?? []).includes(
						'instruction_segments',
					)
					return withAppliedInstructions(run, includeSegments)
				}).pipe(redactDbErrors),

			research_sync: params =>
				Effect.gen(function* () {
					const userId = (yield* SessionContext).userId
					const org = yield* CurrentOrg
					const resolved = yield* resolveForRun(
						org.id,
						userId,
						params.instructions ?? [],
						params.stack,
					)
					if (!resolved.ok) return resolved.clarification
					const context = yield* readContext(params.context)
					if (!context.ok) {
						return { _tag: 'invalid_context' as const, error: context.error }
					}

					// Create the run in its OWN top-level transaction on a fresh
					// pooled connection, detached from this request's transaction.
					// The whole MCP request runs inside one transaction that commits
					// only when the handler returns — but the wait below holds it open.
					// Without detaching, the run row would stay uncommitted the whole
					// time: invisible to the dispatch worker (which runs the job on its
					// own connection, so it never leaves the queue), and rolled back
					// outright if the client gives up and the handler is interrupted —
					// silently losing the run. Committing it here makes it durable and
					// readable the instant create() returns.
					const created = yield* svc
						.create(
							userId,
							org.id,
							{
								query: params.query,
								context: context.value as CreateResearchInput['context'],
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

					// Wait briefly, then hand the run back. An answer already in the
					// cache arrives with its findings straight away; anything else is
					// still going when the wait ends and comes back with a note of when
					// to ask again. Each re-read picks up whatever the worker has
					// committed so far.
					const maxWaitMs =
						Math.min(
							params.max_wait_seconds ?? RESEARCH_SYNC_MAX_WAIT_SECONDS,
							RESEARCH_SYNC_MAX_WAIT_SECONDS,
						) * 1000
					const startedAt = Date.now()

					let run = yield* svc.get(id)
					while (
						run &&
						isActiveResearchStatus((run as { status: string }).status) &&
						Date.now() - startedAt < maxWaitMs
					) {
						yield* Effect.sleep('2 seconds')
						run = yield* svc.get(id)
					}

					return run ? withAppliedInstructions(run) : { error: 'not found' }
				})
					.pipe(Effect.catchTag('SubjectUnavailable', subjectRefusal))
					.pipe(redactDbErrors),
		}
	}),
)
