import { createHash, randomUUID } from 'node:crypto'

import {
	Cause,
	Config,
	DateTime,
	Effect,
	Fiber,
	HashMap,
	Layer,
	PartitionedSemaphore,
	PubSub,
	Queue,
	Ref,
	Schedule,
	Schema,
	ServiceMap,
	Stream,
} from 'effect'
import { Prompt } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { AcceptedCountry } from '../domain/country'
import type { ReasonCode, ResolvedPolicy } from '../domain/types'
import { canAffordAnotherRound, runAgentResearchLoop } from './agent-loop'
import { filterApplicableProposals } from './applicability-guard'
import { makeBudgetLayer } from './budget'
import {
	groundedCitationTest,
	validateFindingCitations,
} from './citation-guard'
import {
	CriticVerdictsSchema,
	criticPrompt,
	critiqueFieldSupport,
} from './critic-guard'
import {
	isDiscoveryScanEmpty,
	isRetryEligible,
	REFINE_HINT,
} from './discovery-scan'
import {
	classifyEntityMatch,
	classifyEntityMatchPerSource,
	deriveAnchorHost,
	deriveEntityTargets,
	domainHost,
	type EntityMatch,
	type EntityTargets,
	groundedSourceIds,
	isConfirmedRegistryMatch,
} from './entity-guard'
import { resolvePolicy, type SystemDefaults } from './policy'
import {
	AgentLanguageModel,
	Budget,
	ExtractLanguageModel,
	RegistryRouter,
	ResearchEventSink,
	ResearchRunContext,
	ScrapeProvider,
	WriterLanguageModel,
} from './ports'
import { type FreeformSchema, schemaRegistry } from './schemas/index'
import { urlHashForScrape } from './source-key'
import { REGISTRY_LOOKUP_COST_CENTS, SCRAPE_COST_CENTS } from './tool-costs'
import {
	isUnsupportedScrapeUrl,
	researchToolkit,
	researchToolkitLayer,
} from './tools'
import { verifyValueProvenance } from './value-guard'
import { constrainVocabulary } from './vocabulary-guard'

// A finished run is flipped to 'failed' for a real error or an unexpected
// crash, but NOT when it was simply cancelled or shut down (a pure interrupt) —
// that path sets its own status. So anything that isn't purely an interrupt
// counts as a failure worth recording.
export const shouldMarkRunFailed = (cause: Cause.Cause<unknown>): boolean =>
	!Cause.hasInterruptsOnly(cause)

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

// Cap a tool result before it goes into the phase-1 transcript, so a large
// scraped page can't blow up the phase-2 prompt or the next round's context.
const boundedToolResult = (value: unknown, maxChars = 4000): string => {
	const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
	return text.length > maxChars
		? `${text.slice(0, maxChars)}…[truncated]`
		: text
}

// A run that fetched no page has nothing to ground its findings on. Below this
// many linked sources it fails closed as no_reliable_data instead of reporting
// success with fabricated findings.
const MIN_GROUNDED_SOURCES = 1

// Provider-independent backstop for the reflect-loop depth: a rough character
// budget on the accumulated prompt (which re-sends every round's tool results),
// used when the model provider omits token usage so the token budget below can't
// fire. Scrapes are capped per page but many of them still add up.
const MAX_LOOP_PROMPT_CHARS = 90000

// When the model finishes without the evidence confirming the target company, it
// gets this many corrective nudges to search harder before the run fails closed.
const MAX_GROUNDING_RETRIES = 1

// Appended after such a premature finish: push the model to reach the company's
// own site (or its registry) rather than answering from look-alike pages.
const GROUNDING_RETRY_INSTRUCTION =
	'You have not yet confirmed this is the right company from its own website. Before giving a final answer, use web_search to find the official website (try the company name together with its city or country), then scrape_page that site — or look up the company in the official registry. Do not answer from the pages you already have if none of them is its own official site.'

// Appended to a re-run's first prompt when a human supplied the correct official
// domain: point the model straight at that site so it grounds on the right company.
const ANCHOR_DOMAIN_INSTRUCTION = (host: string): string =>
	`The correct official website for this company is https://${host}. Use scrape_page on that site first and treat it as the authoritative source for the company's identity and details.`

// Feed extraction only the fetched pages that concern the target, so a look-alike
// company's page pulled in alongside it cannot leak into the extracted fields.
// Falls back to every page when the per-source check grounds none, so a run that
// matched only through a search snippet still has something to extract from.
export const groundedPageTexts = (
	targets: EntityTargets | null,
	pages: ReadonlyArray<{ readonly urlHash: string; readonly text: string }>,
): ReadonlyArray<string> => {
	if (targets === null) return pages.map(page => page.text)
	const verdicts = classifyEntityMatchPerSource(
		targets,
		pages.map(page => ({ sourceId: page.urlHash, text: page.text })),
	)
	const keep = new Set(groundedSourceIds(verdicts))
	const grounded = pages.filter(page => keep.has(page.urlHash))
	return (grounded.length > 0 ? grounded : pages).map(page => page.text)
}

/**
 * Deterministic JSON serializer: sorts object keys and drops function values
 * so two call-sites that pass equivalent hints hash identically regardless of
 * property-declaration order. Plain `JSON.stringify` would preserve insertion
 * order and produce spurious cache misses.
 */
const stableStringify = (value: unknown): string => {
	const seen = new WeakSet<object>()
	const walk = (v: unknown): unknown => {
		if (v === null || typeof v !== 'object') return v
		if (seen.has(v as object)) return '[circular]'
		seen.add(v as object)
		if (Array.isArray(v)) return v.map(walk)
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>)
				.filter(([, val]) => typeof val !== 'function')
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, val]) => [k, walk(val)] as const),
		)
	}
	return JSON.stringify(walk(value))
}

export const normalizeResearchQuery = (query: string): string =>
	query.trim().replace(/\s+/g, ' ').toLowerCase()

export const schemaVersionFor = (schemaName: string): number => {
	const match = schemaName.match(/_v(\d+)$/)
	return match ? Number(match[1]) : 1
}

// Stamp each element of an in-findings review list with an id + pending status,
// so it can later be addressed and resolved one at a time.
const withPendingIds = (items: unknown): unknown =>
	Array.isArray(items)
		? items.map(item =>
				typeof item === 'object' && item !== null && !Array.isArray(item)
					? { id: randomUUID(), status: 'pending', ...item }
					: item,
			)
		: items

/**
 * Give each entry in the two human-reviewed findings lists — the proposed CRM
 * updates and the paid follow-up actions — a stable id and a pending status
 * before the findings are stored, so a human can later resolve that exact entry
 * by id. Non-object findings and every other key pass through untouched.
 */
export const withProposalIds = (findings: unknown): unknown => {
	if (
		typeof findings !== 'object' ||
		findings === null ||
		Array.isArray(findings)
	)
		return findings
	const record = findings as Record<string, unknown>
	const hasProposals = Array.isArray(record['proposed_updates'])
	const hasPaidActions = Array.isArray(record['pending_paid_actions'])
	// No list to stamp: hand the findings back untouched (same reference).
	if (!hasProposals && !hasPaidActions) return findings
	return {
		...record,
		...(hasProposals
			? { proposed_updates: withPendingIds(record['proposed_updates']) }
			: {}),
		...(hasPaidActions
			? { pending_paid_actions: withPendingIds(record['pending_paid_actions']) }
			: {}),
	}
}

// Clamp list pagination so out-of-range input can't reach SQL: a negative limit
// makes Postgres reject `LIMIT -1`, an unbounded one would pull the whole table,
// and a negative offset is meaningless. Defaults match the prior query.
export const clampPagination = (
	limit: number | undefined,
	offset: number | undefined,
): { readonly limit: number; readonly offset: number } => {
	// `Schema.Number` also admits NaN/Infinity/floats, which would reach SQL as
	// `LIMIT NaN` / `LIMIT 2.5`; coerce to a finite integer (or the default) first.
	const toInt = (n: number | undefined, fallback: number): number =>
		n !== undefined && Number.isFinite(n) ? Math.trunc(n) : fallback
	return {
		limit: Math.min(Math.max(toInt(limit, 20), 1), 100),
		offset: Math.max(toInt(offset, 0), 0),
	}
}

export interface PendingProposalRow {
	readonly researchId: string
	readonly runKind: string
	readonly runStatus: string
	readonly runQuery: string
	readonly runCreatedAt: Date
	readonly proposedUpdateId: string | null
	readonly subjectTable: string | null
	readonly subjectId: string | null
	readonly operation: string
	readonly reason: string | null
	readonly confidence: number | null
	readonly verification: string | null
	readonly machineCheckable: boolean
}

/**
 * Pending proposed updates across every run in the org — what the review inbox
 * reads. Each run keeps its proposals inside its own findings, so this unnests
 * them and returns one row per pending proposal with the run + subject context
 * and the trust signals a reviewer sorts by: a 0–100 confidence (the strongest
 * channel score), the email deliverability verdict, and whether the value is
 * machine-checkable (an email or phone the system can verify) rather than free
 * text. Filtered and paginated in SQL so the inbox stays cheap at volume; the
 * org scope is enforced by row-level security, like the run list.
 */
export const queryPendingProposals = (
	sql: SqlClient.SqlClient,
	filters: {
		researchId?: string | undefined
		subjectTable?: string | undefined
		status?: string | undefined
		minConfidence?: number | undefined
		machineCheckable?: boolean | undefined
		limit?: number | undefined
		offset?: number | undefined
	},
) =>
	Effect.gen(function* () {
		const conditions: Array<import('effect/unstable/sql').Statement.Fragment> =
			[]
		if (filters.researchId)
			conditions.push(sql`research_id = ${filters.researchId}`)
		if (filters.subjectTable)
			conditions.push(sql`subject_table = ${filters.subjectTable}`)
		if (filters.status) conditions.push(sql`run_status = ${filters.status}`)
		if (filters.minConfidence != null)
			conditions.push(sql`confidence >= ${filters.minConfidence}`)
		if (filters.machineCheckable != null)
			conditions.push(sql`machine_checkable = ${filters.machineCheckable}`)

		const { limit, offset } = clampPagination(filters.limit, filters.offset)

		// A channel's confidence can be a 0–1 fraction (model) or a 0–100 score
		// (enrichment); normalize to 0–100 so the reviewer's minimum-confidence
		// filter compares like with like. The CASE guards keep a stray non-array
		// `proposed_updates`/`channels` from breaking the row expansion.
		return yield* sql<PendingProposalRow>`
			WITH pending AS (
				SELECT
					r.id AS research_id,
					r.kind AS run_kind,
					r.status AS run_status,
					r.query AS run_query,
					r.created_at AS run_created_at,
					pu->>'id' AS proposed_update_id,
					pu->>'subject_table' AS subject_table,
					pu->>'subject_id' AS subject_id,
					COALESCE(pu->>'operation', 'update') AS operation,
					pu->>'reason' AS reason,
					(
						SELECT max(
							CASE
								WHEN jsonb_typeof(ch->'confidence') = 'number'
								THEN CASE
									WHEN (ch->>'confidence')::numeric <= 1
									THEN (ch->>'confidence')::numeric * 100
									ELSE (ch->>'confidence')::numeric
								END
							END
						)
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(pu->'fields'->'channels') = 'array'
								THEN pu->'fields'->'channels' ELSE '[]'::jsonb END
						) ch
					)::int AS confidence,
					(
						SELECT ch->>'verification'
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(pu->'fields'->'channels') = 'array'
								THEN pu->'fields'->'channels' ELSE '[]'::jsonb END
						) ch
						WHERE ch->>'kind' = 'email'
						LIMIT 1
					) AS verification,
					jsonb_path_exists(
						CASE WHEN jsonb_typeof(pu->'fields'->'channels') = 'array'
							THEN pu->'fields'->'channels' ELSE '[]'::jsonb END,
						'$[*] ? (@.kind == "email" || @.kind == "phone")'
					) AS machine_checkable
				FROM research_runs r,
					LATERAL jsonb_array_elements(
						CASE WHEN jsonb_typeof(r.findings->'proposed_updates') = 'array'
							THEN r.findings->'proposed_updates' ELSE '[]'::jsonb END
					) pu
				WHERE r.status != 'deleted'
					AND pu->>'status' = 'pending'
			)
			SELECT * FROM pending
			WHERE ${sql.and(conditions)}
			ORDER BY run_created_at DESC
			LIMIT ${limit}
			OFFSET ${offset}
		`
	})

// Outcome of a cancel attempt, decided from whether a queued/running row
// actually flipped to cancelled and whether the run exists at all.
export const cancelOutcome = (
	flipped: boolean,
	exists: boolean,
): 'cancelled' | 'already_terminal' | 'not_found' =>
	flipped ? 'cancelled' : exists ? 'already_terminal' : 'not_found'

// Outcome of an attach attempt: the subject must exist before the run, and both
// before the link is written.
export const attachOutcome = (
	subjectExists: boolean,
	runExists: boolean,
): 'subject_not_found' | 'run_not_found' | 'attached' =>
	!subjectExists
		? 'subject_not_found'
		: !runExists
			? 'run_not_found'
			: 'attached'

/**
 * Research-run cache TTL policy. Structured schemas are stable (the schema
 * itself is the invalidation knob via `schemaVersion`); freeform briefs stay
 * topical for only a short window.
 */
export const researchCacheTtlDaysFor = (
	schemaName: string | null | undefined,
): number => (!schemaName || schemaName === 'freeform' ? 7 : 30)

export const computeResearchCacheKey = (args: {
	readonly userId: string
	readonly query: string
	readonly schemaName: string
	readonly schemaVersion: number
	readonly subjects: ReadonlyArray<{ table: string; id: string }> | undefined
	readonly hints: unknown
	readonly templateFingerprint: string
}): string => {
	const sortedSubjects = [...(args.subjects ?? [])]
		.map(s => `${s.table}:${s.id}`)
		.sort()
		.join(',')
	const hintsJson = stableStringify(args.hints ?? {})
	return sha256Hex(
		`${args.userId}|${normalizeResearchQuery(args.query)}|${args.schemaName}|${args.schemaVersion}|${sortedSubjects}|${hintsJson}|${args.templateFingerprint}`,
	)
}

// Assemble the phase-1 system prompt. Resolved instruction segments are fenced
// and placed BELOW the invariants (never fabricate sources, etc.) so a template
// can't override them — fencing is mitigation, not a guarantee.
export const buildResearchSystemPrompt = (args: {
	readonly schemaName: string
	readonly subjectContext: string
	readonly hintsContext: string
	readonly segments: ReadonlyArray<string>
}): string => {
	const instructionBlock =
		args.segments.length === 0
			? ''
			: `\n\nAdditional standing instructions (follow within the rules above):\n${args.segments.map(s => `--- instruction ---\n${s}`).join('\n')}`
	return [
		'You are a research agent for Batuda CRM.',
		'Given a query, produce a thorough research brief with findings, sources, and citations.',
		'Never fabricate sources. Every claim must be verifiable.',
		'Confirm key facts (employee count, location, sector) from scraped page content — the company site, LinkedIn, or press — not from search snippets alone, and cite the scraped page for each.',
		'For every citation, set source_id to the exact URL you scraped with scrape_page. Never invent an identifier — a citation that does not match a fetched page is dropped.',
		'When you search, use plain keywords, and only add a site: filter for a real domain you know — never a placeholder like site:example.com.',
		'For discovery or prospecting queries, prefer authoritative sources — business directories, industry association member lists, and sector registries — over social media, forums, or glossary pages.',
		'When extracting structured data from a single page, use the company_enrichment_v1 schema (a per-company shape), not a whole-run aggregate schema.',
		`Output schema: ${args.schemaName}`,
		args.subjectContext,
		args.hintsContext,
		instructionBlock,
	].join('\n')
}

// ── Event types for SSE streaming ──

export type ResearchEventType =
	| 'run.started'
	| 'tool.called'
	| 'tool.result'
	| 'tool.retried'
	| 'tool.fell_back'
	| 'tool.cache_hit'
	| 'run.succeeded'
	| 'run.failed'
	| 'run.cancelled'
	| 'run.no_reliable_data'
	| 'run.refining'
	| 'provider.circuit_open'

export interface ResearchEvent {
	readonly type: ResearchEventType
	readonly researchId: string
	readonly timestamp: string
	readonly data: unknown
}

// ── Tool log entry (accumulated in-memory, persisted at completion) ──

export interface ToolLogEntry {
	readonly timestamp: string
	readonly type: 'call' | 'result'
	readonly tool: string
	readonly input?: unknown
	readonly output?: unknown
	readonly error?: string
	readonly durationMs?: number
}

// ── Research run input (from HTTP handler) ──

export interface CreateResearchInput {
	readonly query: string
	readonly mode?: string | undefined
	readonly context?:
		| {
				anchorDomain?: string | undefined
				subjects?:
					| Array<{ table: 'companies' | 'contacts'; id: string }>
					| undefined
				selector?:
					| { table: 'companies'; filter: Record<string, unknown> }
					| undefined
				hints?:
					| {
							language?: 'ca' | 'es' | 'en' | undefined
							recency_days?: number | undefined
							location?: string | undefined
					  }
					| undefined
		  }
		| undefined
	readonly schemaName?: string | undefined
	readonly budgetCents?: number | undefined
	readonly paidBudgetCents?: number | undefined
	readonly autoApprovePaidCents?: number | undefined
	readonly idempotencyKey?: string | undefined
	readonly confirm?: boolean | undefined
	readonly forceFresh?: boolean | undefined
}

// Resolved instruction layer for a run: ordered prompt segments and a
// fingerprint that changes when the underlying templates do, so editing or
// swapping a template invalidates the run cache. The app layer resolves these
// in the request scope and passes them in — research never resolves them.
export interface ResolvedInstructions {
	readonly segments: ReadonlyArray<string>
	readonly fingerprint: string
	readonly templateIds: ReadonlyArray<string>
	readonly templateNames: ReadonlyArray<string>
}

// ── ResearchService ──

export class ResearchService extends ServiceMap.Service<ResearchService>()(
	'ResearchService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const agentLlm = yield* AgentLanguageModel
			const extractLlm = yield* ExtractLanguageModel
			const writerLlm = yield* WriterLanguageModel
			// The toolkit handlers are resolved per-run inside `runFiber` (not
			// here) so each run's paid tools charge that run's Budget. Resolving
			// them there discharges `HandlersFor<Tools>` inside the fiber, so it
			// never leaks out as a lingering context requirement.

			const ORPHAN_AGE_SECONDS = 900

			// Heartbeat cadence, the staleness window before a run counts as crashed,
			// and how often the sweep runs. These only tune timing, so a default is
			// safe when a var is unset — unlike the vars that switch behavior on or off.
			const heartbeatIntervalSeconds = yield* Config.int(
				'RESEARCH_HEARTBEAT_INTERVAL_SEC',
			).pipe(Config.withDefault(30))
			const orphanStaleSeconds = yield* Config.int(
				'RESEARCH_ORPHAN_STALE_SEC',
			).pipe(Config.withDefault(90))
			const orphanSweepIntervalSeconds = yield* Config.int(
				'RESEARCH_ORPHAN_SWEEP_INTERVAL_SEC',
			).pipe(Config.withDefault(60))

			// Fail 'running' rows whose worker died — detected by a heartbeat that
			// stopped refreshing (a live long run keeps beating, so it is spared).
			// Rows from before heartbeats existed fall back to age. A paid run isn't
			// safe to silently re-run, so it is not re-dispatched.
			const sweepOrphanRuns = (maxAgeSeconds: number) =>
				Effect.gen(function* () {
					// COALESCE guards NULL findings: jsonb_set(NULL, …) returns
					// NULL, which would silently drop the error field on rows
					// that never wrote findings (newly-queued rows especially).
					// `seed:%` rows are dev fixtures, not orphans.
					const running = yield* sql<{ id: string }>`
						UPDATE research_runs
						SET status = 'failed',
							reason_code = ${'internal_error' satisfies ReasonCode},
							findings = jsonb_set(COALESCE(findings, '{}'::jsonb), '{error}', '"server restarted mid-run"'),
							completed_at = now(),
							updated_at = now()
						WHERE status = 'running'
						  AND (
						        heartbeat_at < now() - interval '1 second' * ${orphanStaleSeconds}
						     OR (heartbeat_at IS NULL AND started_at < now() - interval '1 second' * ${maxAgeSeconds})
						  )
						  AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'seed:%')
						RETURNING id
					`
					return { running }
				}).pipe(sql.withTransaction)

			// Active runs: pubsub channels and fibers for cancellation
			const activePubSubs = yield* Ref.make(
				HashMap.empty<string, PubSub.PubSub<ResearchEvent>>(),
			)
			const activeFibers = yield* Ref.make(
				HashMap.empty<string, Fiber.Fiber<void, unknown>>(),
			)

			// Fiber concurrency gate. Shared permit pool, waiters queued per
			// userId — releases round-robin across partitions so one tenant's
			// burst cannot starve the rest. Capacity is fixed at service
			// construction; changing it requires a restart.
			const maxConcurrentFibersTotal = yield* Config.int(
				'RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL',
			)
			// Hard cap on reflect-loop rounds per run. Bounds how far the agent can
			// search, so it is required with no default — like the concurrency cap.
			const maxAgentSteps = yield* Config.int('RESEARCH_MAX_AGENT_STEPS')
			// How many prompt tokens the reflect loop may reach before it stops
			// searching, so a bigger-context model can look further. Required with no
			// default — set per the chosen agent model's context window.
			const maxLoopPromptTokens = yield* Config.int(
				'RESEARCH_MAX_LOOP_PROMPT_TOKENS',
			)
			// System ceiling on monthly paid spend; the per-call cap check takes the
			// min of this and the user's cap. Already set in production config, with a
			// default so local and test boots don't need it.
			const monthlyCapHardCeilingCents = yield* Config.int(
				'RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS',
			).pipe(Config.withDefault(10000))
			// Most companies one selector run may fan out across, so a broad filter
			// can't spawn an unbounded number of leaf runs.
			const selectorMaxCompanies = yield* Config.int(
				'RESEARCH_SELECTOR_MAX_COMPANIES',
			).pipe(Config.withDefault(100))
			const fiberSem = yield* PartitionedSemaphore.make<string>({
				permits: maxConcurrentFibersTotal,
			})

			// Dispatch channel: create() offers a queued run here; the
			// layer-scoped consumer (below) drains it and runs each job on the
			// service's own connection. Unbounded so create() never blocks —
			// concurrency is bounded by the permit pool above. research_runs is
			// the durable record and this queue is only an in-process hand-off,
			// so the reconcile below re-offers any run left queued.
			const dispatch = yield* Queue.unbounded<{
				researchId: string
				userId: string
			}>()

			// Re-offer every committed queued run to the dispatch queue. create()
			// also offers on the request path, but it does so while the run's row is
			// still uncommitted in the request transaction, so the consumer's own
			// connection may not see it yet. This runs outside any request
			// transaction, so it picks up every run left queued — a raced offer, a
			// crash, or another process. The consumer skips runs already in flight,
			// so re-offers never double-run.
			const reofferQueued = Effect.gen(function* () {
				const pending = yield* sql<{ id: string; createdBy: string }>`
					SELECT id, created_by FROM research_runs
					WHERE status = 'queued'
					  AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'seed:%')
					-- Oldest first, capped at the concurrency limit so a large backlog
					-- drains in waves instead of forking every run at once.
					ORDER BY created_at
					LIMIT ${maxConcurrentFibersTotal}
				`
				yield* Effect.forEach(
					pending,
					row =>
						Queue.offer(dispatch, {
							researchId: row.id,
							userId: row.createdBy,
						}),
					{ discard: true },
				)
				if (pending.length > 0) {
					yield* Effect.logInfo(
						'research.dispatch: re-offered queued runs',
					).pipe(Effect.annotateLogs({ count: pending.length }))
				}
			})

			// ── Event sink (observability: webhooks, metrics) ──
			const eventSink = yield* ResearchEventSink

			// ── Helpers ──

			const publishEvent = (
				researchId: string,
				type: ResearchEventType,
				data: unknown,
			) =>
				Effect.gen(function* () {
					const map = yield* Ref.get(activePubSubs)
					const maybePubSub = HashMap.get(map, researchId)
					if (maybePubSub._tag === 'Some') {
						yield* PubSub.publish(maybePubSub.value, {
							type,
							researchId,
							timestamp: DateTime.nowUnsafe().toString(),
							data,
						})
					}
					// Fire to external observability (webhooks, metrics)
					yield* eventSink.fire(`research.${type.replace('run.', '')}`, {
						researchId,
						...(typeof data === 'object' && data !== null ? data : { data }),
					})
				})

			const snapshotSubjects = (
				subjects: Array<{ table: string; id: string }>,
			) =>
				Effect.gen(function* () {
					const snapshots = []
					for (const s of subjects) {
						const [row] = yield* sql`
							SELECT *, version FROM ${sql(s.table)}
							WHERE id = ${s.id} AND deleted_at IS NULL
							LIMIT 1
						`
						if (row) {
							snapshots.push({
								...s,
								snapshot: row,
								expected_version: (row as { version: number }).version,
							})
						}
					}
					return snapshots
				})

			// Recompute a group parent's status from its children: still running if
			// any child is in flight, failed if any finished without success, else
			// succeeded. Sets completed_at once no child is in flight.
			const rollupParentStatus = (parentId: string) =>
				sql`
					UPDATE research_runs
					SET status = CASE
						WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') > 0
						THEN 'running'
						WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('failed', 'no_reliable_data'))
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') > 0
						THEN 'failed'
						ELSE 'succeeded'
					END,
					completed_at = CASE
						WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))
							FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') = 0
						THEN now() ELSE completed_at
					END,
					updated_at = now()
					WHERE id = ${parentId}
				`

			/** Merge leaf findings into parent group row (advisory-locked). */
			const mergeToParent = (parentId: string, leafFindings: unknown) =>
				Effect.gen(function* () {
					yield* sql`SELECT pg_advisory_xact_lock(hashtext(${parentId}))`
					yield* sql`
						UPDATE research_runs
						SET findings = jsonb_set(
							findings,
							'{leaf_results}',
							COALESCE(findings->'leaf_results', '[]'::jsonb)
								|| ${JSON.stringify([leafFindings])}::jsonb
						),
						updated_at = now()
						WHERE id = ${parentId}
					`
					yield* rollupParentStatus(parentId)
				}).pipe(sql.withTransaction)

			// Roll a group parent up from its children under the same advisory lock,
			// without appending findings — used when a leaf ends without success, so
			// an all-failed group still resolves instead of hanging.
			const rollupParentLocked = (parentId: string) =>
				Effect.gen(function* () {
					yield* sql`SELECT pg_advisory_xact_lock(hashtext(${parentId}))`
					yield* rollupParentStatus(parentId)
				}).pipe(sql.withTransaction)

			// Append a follow-up run's result onto the run that proposed it, under an
			// advisory lock. Deliberately does NOT recompute the origin's status: the
			// origin already finished, and the follow-up is extra evidence, not a child
			// whose outcome should change the origin's.
			const mergeFollowupToOrigin = (originId: string, result: unknown) =>
				Effect.gen(function* () {
					yield* sql`SELECT pg_advisory_xact_lock(hashtext(${originId}))`
					yield* sql`
						UPDATE research_runs
						SET findings = jsonb_set(
							findings,
							'{followup_results}',
							COALESCE(findings->'followup_results', '[]'::jsonb)
								|| ${JSON.stringify([result])}::jsonb
						),
						updated_at = now()
						WHERE id = ${originId}
					`
				}).pipe(sql.withTransaction)

			// Run one approved paid action in a follow-up run. Only a registry lookup
			// runs automatically — anything else is refused so an unrecognized action
			// can never spend. Its arguments are validated, the run's budget + monthly
			// cap are charged (fail-closed with no spend when over cap), and the result
			// is merged back onto the origin run.
			const runFollowup = (researchId: string, run: Record<string, unknown>) =>
				Effect.gen(function* () {
					// Read the context as raw text so its keys keep the snake_case they
					// were stored with; the SQL client would otherwise camelCase every
					// nested key and hide the paid action.
					const [ctxRow] = yield* sql<{ context: string | null }>`
						SELECT context::text AS context FROM research_runs WHERE id = ${researchId}
					`
					const paidContext = (
						ctxRow?.context ? JSON.parse(ctxRow.context) : null
					) as {
						paid_action?: {
							tool?: unknown
							args?: unknown
							origin_run_id?: unknown
						}
					} | null
					const paidAction = paidContext?.paid_action
					const originId =
						typeof paidAction?.origin_run_id === 'string'
							? paidAction.origin_run_id
							: null
					const tool = paidAction?.tool

					const finishFailed = (error: string) =>
						Effect.gen(function* () {
							// Merge onto the origin before marking this run terminal, so a
							// caller that sees the terminal status also sees the result —
							// the origin write is durable before the followup reports done.
							if (originId)
								yield* mergeFollowupToOrigin(originId, {
									tool: typeof tool === 'string' ? tool : null,
									error,
								})
							yield* sql`
								UPDATE research_runs
								SET status = 'failed',
									reason_code = ${'internal_error' satisfies ReasonCode},
									findings = ${JSON.stringify({ error })},
									completed_at = now(), updated_at = now()
								WHERE id = ${researchId} AND status = 'running'
							`
							yield* publishEvent(researchId, 'run.failed', { error })
						})

					if (!originId)
						return yield* finishFailed('follow-up run has no origin')
					if (tool !== 'registry_lookup')
						return yield* finishFailed(`unsupported paid tool: ${String(tool)}`)

					const args = (paidAction?.args ?? {}) as {
						country?: unknown
						tax_id?: unknown
						query?: unknown
					}
					const countryRaw =
						typeof args.country === 'string' ? args.country.toUpperCase() : null
					if (!countryRaw)
						return yield* finishFailed('registry_lookup requires a country')
					if (!Schema.is(AcceptedCountry)(countryRaw))
						return yield* finishFailed(`unsupported country: ${countryRaw}`)
					const country = countryRaw
					const taxId =
						typeof args.tax_id === 'string' ? args.tax_id : undefined
					const query = typeof args.query === 'string' ? args.query : undefined

					const organizationId = (run as { organizationId: string })
						.organizationId
					const createdBy =
						(run as { createdBy: string | null }).createdBy ?? ''
					const policy = (run as { paidPolicy: ResolvedPolicy }).paidPolicy
					const budgetLayer = makeBudgetLayer({
						organizationId,
						userId: createdBy,
						researchId,
						policy,
						systemCeiling: monthlyCapHardCeilingCents,
					}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

					const outcome = yield* Effect.gen(function* () {
						const budget = yield* Budget
						const registry = yield* RegistryRouter
						// Deterministic key: an approve-retry reuses the same follow-up id,
						// so re-charging the same lookup is a no-op, never a double spend.
						const key = `${researchId}:registry:${country}:${taxId ?? query ?? ''}`
						yield* budget.chargePaid(
							'registry',
							REGISTRY_LOOKUP_COST_CENTS,
							'registry_lookup',
							key,
						)
						return yield* registry.lookup({ country, taxId, query })
					}).pipe(Effect.provide(budgetLayer), Effect.result)

					if (outcome._tag === 'Failure') {
						// Over the monthly cap the charge is refused before any spend row
						// is written, so this fails closed with no money moved.
						const err = outcome.failure as { _tag?: string }
						return yield* finishFailed(err._tag ?? 'paid lookup failed')
					}

					// Merge onto the origin before marking this run terminal, so a caller
					// that sees 'succeeded' also sees the result already recorded.
					yield* mergeFollowupToOrigin(originId, {
						tool: 'registry_lookup',
						result: outcome.success,
					})
					yield* sql`
						UPDATE research_runs
						SET status = 'succeeded',
							findings = ${JSON.stringify({ paid_action_result: outcome.success })},
							completed_at = now(), updated_at = now()
						WHERE id = ${researchId} AND status = 'running'
					`
					yield* publishEvent(researchId, 'run.succeeded', {})
				})

			// Release a run's in-memory resources on any exit — success, failure, or
			// an interrupt while it is still waiting for a concurrency slot. Applied
			// around the whole job below (permit wait included), not inside it, so a
			// cancel before the run acquires a slot still shuts the channel down and
			// clears the maps.
			const cleanupRun = (researchId: string) =>
				Effect.gen(function* () {
					// Shut the channel before dropping the map entry so the terminal
					// signal reaches subscribers; otherwise the subscriber's event
					// stream stays open until the HTTP socket drops.
					const pubsubMap = yield* Ref.get(activePubSubs)
					const maybePubSub = HashMap.get(pubsubMap, researchId)
					if (maybePubSub._tag === 'Some') {
						yield* PubSub.shutdown(maybePubSub.value)
					}
					yield* Ref.update(activePubSubs, m => HashMap.remove(m, researchId))
					yield* Ref.update(activeFibers, m => HashMap.remove(m, researchId))
				})

			// ── Core: run a single research fiber ──

			const runFiber = (researchId: string, userId: string) =>
				Effect.gen(function* () {
					// Claim the run: proceed only if it is still queued. The consumer
					// forks this after acquiring a concurrency permit, so the flip to
					// running lands when work actually starts (a run waiting for a
					// slot stays queued), and a run cancelled or already claimed while
					// it waited is skipped.
					const [claimed] = yield* sql<{ id: string }>`
						UPDATE research_runs
						SET status = 'running', started_at = now(), heartbeat_at = now(), updated_at = now()
						WHERE id = ${researchId} AND status = 'queued'
						RETURNING id
					`
					if (!claimed) return

					// Refresh the heartbeat while this run works, so the sweep can
					// tell a live long-running job from one whose worker died. Forked
					// into the run's own scope (below), so it stops when the run ends.
					yield* sql`
						UPDATE research_runs SET heartbeat_at = now()
						WHERE id = ${researchId} AND status = 'running'
					`.pipe(
						Effect.catchCause(() => Effect.void),
						Effect.repeat(
							Schedule.spaced(`${heartbeatIntervalSeconds} seconds`),
						),
						Effect.forkScoped,
					)

					yield* publishEvent(researchId, 'run.started', {})

					// Load the run row
					const [run] = yield* sql`
						SELECT * FROM research_runs WHERE id = ${researchId}
					`
					if (!run) return

					// The run's inputs live on the row so the dispatch consumer can
					// reconstruct it (including after a restart): segments shape the
					// phase-1 prompt, the fingerprint keys the cache write-back.
					const segments = ((
						run as { instructionSegments?: ReadonlyArray<string> }
					).instructionSegments ?? []) as ReadonlyArray<string>
					const templateFingerprint =
						(run as { templateFingerprint?: string | null })
							.templateFingerprint ?? ''

					const context = run['context'] as CreateResearchInput['context']
					const schemaName =
						(run as { schemaName: string | null }).schemaName ?? 'freeform'

					// ── Checkpoint state from any prior partial run ──
					// `phase` + `research_text` + `findings` are persisted after each
					// phase; on resume we skip already-completed phases.
					const checkpointPhase = ((run as { phase?: number | null }).phase ??
						0) as number
					const cachedResearchText = (run as { researchText?: string | null })
						.researchText
					const existingFindings = run['findings'] as Record<
						string,
						unknown
					> | null
					const existingFindingsHasValue =
						existingFindings !== null &&
						typeof existingFindings === 'object' &&
						Object.keys(existingFindings).length > 0 &&
						!('error' in existingFindings)

					// Snapshot subjects if anchored
					const subjects = context?.subjects
						? yield* snapshotSubjects(context.subjects)
						: []

					// The keys that prove the fetched evidence is about the requested
					// company (its name or its own domain). A scan or freeform run with
					// no anchored subject is not entity-gated (targets is null). The
					// verdict is computed from the phase-1 evidence below and, on resume,
					// read back from the row so the weak-match handling survives a restart.
					const subjectTargets = subjects.map(s => {
						const row = s.snapshot as Record<string, unknown>
						return {
							table: s.table,
							name: typeof row['name'] === 'string' ? row['name'] : undefined,
							website:
								typeof row['website'] === 'string' ? row['website'] : undefined,
						}
					})
					const entityTargets = deriveEntityTargets({
						schemaName,
						anchorDomain: context?.anchorDomain,
						query: (run as { query: string }).query,
						subjects: subjectTargets,
					})
					let entityMatch: EntityMatch | null =
						(run as { entityMatch?: EntityMatch | null }).entityMatch ?? null

					// The company's own official site to fetch up front, when the caller
					// gave its domain — a target-correction re-run's anchor, an anchored
					// subject's website, or a domain written into the query. The instruction
					// nudges the model there; the seeded scrape below guarantees the page is
					// fetched even if the model never navigates to it.
					const anchorHost = deriveAnchorHost({
						schemaName,
						anchorDomain: context?.anchorDomain,
						query: (run as { query: string }).query,
						subjects: subjectTargets,
					})
					const anchorInstruction =
						anchorHost !== undefined
							? `\n\n${ANCHOR_DOMAIN_INSTRUCTION(anchorHost)}`
							: ''

					// A follow-up run performs one approved paid call instead of the
					// normal research loop, then merges the result onto the origin run.
					if ((run as { kind?: string }).kind === 'followup') {
						yield* runFollowup(researchId, run as Record<string, unknown>)
						return
					}

					// Resolve the schema
					const outputSchema = schemaRegistry[schemaName]
					if (!outputSchema) {
						yield* sql`
							UPDATE research_runs
							SET status = 'failed',
								reason_code = ${'internal_error' satisfies ReasonCode},
								findings = ${JSON.stringify({ error: `Unknown schema: ${schemaName}` })},
								completed_at = now(), updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						yield* publishEvent(researchId, 'run.failed', {
							error: `Unknown schema: ${schemaName}`,
						})
						return
					}

					// Tool log accumulator
					const toolLog = yield* Ref.make<ToolLogEntry[]>([])

					// True once a registry_lookup this run resolved the target company by
					// its legal name — a strong, site-independent confirmation the run
					// reached the right entity. Stamped onto the findings so the eval can
					// count it toward grounding even when the company's own site was never
					// fetched; nothing in the product reads it. A resumed run skips phase 1
					// and so never sets it (the eval always runs fresh, so it never resumes).
					let registryConfirmed = false
					const withRegistryFlag = (
						obj: Record<string, unknown>,
					): Record<string, unknown> =>
						registryConfirmed ? { ...obj, registry_confirmed: true } : obj

					// Fail a run closed as no_reliable_data because its evidence was not clearly
					// about the requested company. Called by the phase-1 entity gate and again on
					// resume, where that gate is skipped — so a weak or absent match never reaches
					// extraction to present a lookalike's profile.
					const failClosedOnEntity = (verdict: EntityMatch) =>
						Effect.gen(function* () {
							const toolLogNow = yield* Ref.get(toolLog)
							yield* sql`
								UPDATE research_runs
								SET status = 'no_reliable_data',
									reason_code = ${(verdict === 'weak' ? 'weak_no_official_site' : 'entity_mismatch') satisfies ReasonCode},
									phase = 1,
									entity_match = ${verdict},
									findings = ${JSON.stringify(
										withRegistryFlag({
											error:
												'The fetched pages were not clearly about the requested company, so the findings could not be grounded.',
											reason: 'no_reliable_data',
										}),
									)},
									tool_log = ${JSON.stringify(toolLogNow)},
									completed_at = now(),
									updated_at = now()
								WHERE id = ${researchId} AND status = 'running'
							`
							yield* publishEvent(researchId, 'run.no_reliable_data', {
								reason: verdict === 'weak' ? 'entity_weak' : 'entity_mismatch',
								entityMatch: verdict,
							})
							const parentGroupId = (run as { parentId: string | null })
								.parentId
							if (parentGroupId) yield* rollupParentLocked(parentGroupId)
						})

					// Build system prompt
					const subjectContext =
						subjects.length > 0
							? `\n\nSubject data (frozen snapshot):\n${JSON.stringify(subjects, null, 2)}`
							: ''
					// The stored hints round-trip through the camelCasing row transform,
					// so read `recencyDays`, not the request's `recency_days`.
					const hints = context?.hints as
						| { language?: string; recencyDays?: number; location?: string }
						| undefined
					const hintsContext = hints
						? `\n\nHints: language=${hints.language ?? 'en'}, recency=${hints.recencyDays ?? 'any'}, location=${hints.location ?? 'any'}`
						: ''
					const systemPrompt = buildResearchSystemPrompt({
						schemaName,
						subjectContext,
						hintsContext,
						segments,
					})

					// Prior-run token tally carried across resumes
					const priorTokensIn =
						(run as { tokensIn?: number | null }).tokensIn ?? 0
					const priorTokensOut =
						(run as { tokensOut?: number | null }).tokensOut ?? 0

					// ── Phase 1: LLM research pass ──
					// Skipped on resume if the checkpoint captured research_text.
					let researchText: string
					// Evidence-only corpus (tool results, no model prose) for the value
					// guard; empty on a resume that skips phase 1.
					let evidenceText = ''
					let tokensIn = priorTokensIn
					let tokensOut = priorTokensOut
					// Full scraped page content gathered this run — the corpus the value
					// guard checks findings against. Kept separate from the model-facing
					// transcript (capped per page); empty on a resume that skips phase 1.
					const scrapeCorpus: Array<{ urlHash: string; text: string }> = []
					// The anchor site fetched up front (see below): its url hash to link as
					// a source, and its capped rendered text to prepend to the transcript so
					// phase-2 extraction reads the official site even if the model never did.
					const seededAnchorHashes: string[] = []
					const seededTranscriptParts: string[] = []
					// Findings the discovery-scan retry path extracts under the shared
					// budget; undefined on every other path (which extracts in phase 2).
					let retryFindings: unknown
					let retryExtractTokens = 0

					// Phase-2 extraction + every grounding guard, shared so both the
					// normal path and the discovery-scan retry run the same logic. Returns
					// cleaned findings and the model's output tokens; the caller writes the
					// single phase-2 checkpoint.
					const extractStructuredFindings = (
						transcript: string,
						evidenceCorpus: string,
					) =>
						Effect.gen(function* () {
							yield* publishEvent(researchId, 'tool.called', {
								tool: 'llm.generateObject',
								phase: 2,
								schema: schemaName,
							})
							// The model must cite the exact fetched URL, but the transcript
							// buries URLs inside tool-result JSON — so hand it the run's fetched
							// sources explicitly and have it copy one verbatim. Without this it
							// tends to cite a tidied URL the guard can't match, or omit citations.
							const sourceRows = yield* sql<{ url: string }>`
								SELECT DISTINCT s.url
								FROM research_run_sources rs JOIN sources s ON s.id = rs.source_id
								WHERE rs.research_id = ${researchId}
								ORDER BY s.url
							`
							const sourceManifest = sourceRows.map(row => row.url).join('\n')
							const citationInstruction =
								sourceManifest.length > 0
									? `For each citation, set source_id to one of these exact fetched source URLs, copied verbatim — prefer the company's own official website, and never cite a URL not in this list:\n\n${sourceManifest}`
									: "Set each citation's source_id to the exact scraped URL the value came from."
							// Cast schema to satisfy generateObject's Encoder constraint.
							// Registry schemas are all Structs with DecodingServices=never,
							// but Schema.Top erases that — the cast is safe.
							const structuredResponse = yield* extractLlm.generateObject({
								schema: outputSchema as typeof FreeformSchema,
								// Ground the extraction: the model may only output values that
								// appear in the transcript, and must leave unsupported fields
								// empty rather than filling them from prior knowledge — otherwise
								// it will confidently invent phones, tax ids, and emails.
								prompt: `Produce structured findings STRICTLY from the research transcript below. Only include a value that appears in the transcript; if the transcript does not support a field, omit it or leave it null — never fill a field from prior knowledge.\n\n${citationInstruction}\n\nResearch transcript:\n\n${transcript}`,
							})
							let result = withProposalIds(structuredResponse.value as unknown)
							// Drop citations the model invented: keep only source_ids that map
							// to a page this run actually fetched. A proposed CRM update left
							// with no valid citation is dropped whole.
							const groundedRows = yield* sql<{
								localRef: string
								sourceId: string
							}>`
								SELECT local_ref AS "localRef", source_id AS "sourceId"
								FROM research_run_sources WHERE research_id = ${researchId}
							`
							const citationCheck = validateFindingCitations(
								result,
								groundedCitationTest(groundedRows),
							)
							result = citationCheck.findings
							if (citationCheck.total > citationCheck.kept) {
								yield* Effect.logWarning('research.citations.dropped').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										total: citationCheck.total,
										kept: citationCheck.kept,
									}),
								)
							}
							// Value provenance: the citation guard proved the cited pages were
							// fetched, not that they contain the claimed values. Drop any
							// proposed CRM write whose email/phone/tax-id value appears nowhere
							// in the run's evidence — that value was invented, real citation or
							// not. Evidence is tool results only, never the model's own prose.
							const valueCheck = verifyValueProvenance(result, evidenceCorpus)
							result = valueCheck.findings
							if (
								valueCheck.droppedProposals > 0 ||
								valueCheck.strippedValues > 0
							) {
								yield* Effect.logWarning('research.values.unsupported').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										dropped_proposals: valueCheck.droppedProposals,
										stripped_values: valueCheck.strippedValues,
									}),
								)
							}
							// Vocabulary: rewrite industry/region/size to the CRM's fixed codes so
							// what reaches the CRM matches the classification the UI offers — a
							// real-but-uncategorized value becomes 'other', junk is dropped. Runs
							// before applicability, so a proposal emptied by dropping its only
							// field is then dropped as unappliable.
							const vocab = constrainVocabulary(result)
							result = vocab.findings
							if (vocab.mapped > 0 || vocab.blanked > 0) {
								yield* Effect.logInfo('research.vocabulary.normalized').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										mapped: vocab.mapped,
										blanked: vocab.blanked,
									}),
								)
							}
							// Applicability: drop any proposed CRM update that could never be
							// applied — an update whose subject_id names no live row (the model
							// can invent one for a company that does not exist), or a proposal
							// whose fields carry no real values. Existence is checked against
							// the org's own rows; a malformed id trips a cast error read as
							// "not found".
							const organizationId = (run as { organizationId: string })
								.organizationId
							const proposalList =
								result != null &&
								typeof result === 'object' &&
								!Array.isArray(result)
									? (result as Record<string, unknown>)['proposed_updates']
									: undefined
							const liveSubjects = new Set<string>()
							if (Array.isArray(proposalList)) {
								for (const proposal of proposalList) {
									if (proposal == null || typeof proposal !== 'object') continue
									const pu = proposal as Record<string, unknown>
									if (pu['operation'] === 'create') continue
									const table = pu['subject_table']
									const id = pu['subject_id']
									if (
										(table !== 'companies' && table !== 'contacts') ||
										typeof id !== 'string' ||
										id.trim() === '' ||
										liveSubjects.has(`${table}:${id}`)
									)
										continue
									const rows = yield* sql`
										SELECT id FROM ${sql(table)}
										WHERE id = ${id}
											AND organization_id = ${organizationId}
											AND deleted_at IS NULL
										LIMIT 1
									`.pipe(Effect.catchTag('SqlError', () => Effect.succeed([])))
									if (rows.length > 0) liveSubjects.add(`${table}:${id}`)
								}
							}
							const applicability = filterApplicableProposals(
								result,
								(table, id) => liveSubjects.has(`${table}:${id}`),
							)
							result = applicability.findings
							if (applicability.dropped > 0) {
								yield* Effect.logWarning('research.proposals.unappliable').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										dropped: applicability.dropped,
									}),
								)
							}
							yield* publishEvent(researchId, 'tool.result', {
								tool: 'llm.generateObject',
								phase: 2,
								schema: schemaName,
							})
							// Critic: a final per-field second look. For each value still carrying a
							// source + quote, ask the extract model whether the quote really backs
							// the value and is about the target company — the deterministic guards
							// proved the value is in the evidence, this checks the cited quote
							// supports it. Fail open: a judge error keeps the guarded fields.
							const targetSnapshot = subjects[0]?.snapshot as
								| Record<string, unknown>
								| undefined
							const criticTarget = {
								name:
									typeof targetSnapshot?.['name'] === 'string'
										? targetSnapshot['name']
										: (run as { query: string }).query,
								domain:
									typeof targetSnapshot?.['website'] === 'string'
										? targetSnapshot['website']
										: entityTargets?.domains[0],
							}
							const critiqued = yield* critiqueFieldSupport(result, claims =>
								extractLlm
									.generateObject({
										schema: CriticVerdictsSchema,
										prompt: criticPrompt(criticTarget, claims),
									})
									.pipe(
										Effect.map(response => ({
											verdicts: response.value.verdicts,
											outputTokens: response.usage.outputTokens.total ?? 0,
										})),
										Effect.catchCause(() =>
											Effect.succeed({ verdicts: [], outputTokens: 0 }),
										),
									),
							)
							result = critiqued.findings
							if (critiqued.dropped > 0 || critiqued.flagged > 0) {
								yield* Effect.logWarning('research.critic.dropped').pipe(
									Effect.annotateLogs({
										research_id: researchId,
										criticised: critiqued.criticised,
										dropped: critiqued.dropped,
										flagged: critiqued.flagged,
									}),
								)
							}
							return {
								findings: result as unknown,
								outputTokens:
									(structuredResponse.usage.outputTokens.total ?? 0) +
									critiqued.outputTokens,
							}
						}).pipe(
							Effect.withSpan('research.phase2', {
								attributes: {
									'research.run_id': researchId,
									schema: schemaName,
								},
							}),
						)

					// Link each page that returned content to the run so findings cite
					// real sources; the sources row was upserted by the search cache
					// (matched by url_hash). Re-running is a no-op via ON CONFLICT.
					const linkRunSources = (hashes: ReadonlyArray<string>) =>
						Effect.gen(function* () {
							const organizationId = (run as { organizationId: string })
								.organizationId
							for (const urlHash of hashes) {
								yield* sql`
									INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
									SELECT ${organizationId}, ${researchId}, s.id, s.url, now(), 0
									FROM sources s
									WHERE s.url_hash = ${urlHash}
									ON CONFLICT DO NOTHING
								`
							}
						})

					if (checkpointPhase >= 1 && cachedResearchText) {
						researchText = cachedResearchText
						yield* Effect.logInfo('research.phase1.resume').pipe(
							Effect.annotateLogs({
								research_id: researchId,
								text_length: researchText.length,
							}),
						)
					} else {
						const organizationId = (run as { organizationId: string })
							.organizationId
						const query = (run as { query: string }).query

						// The policy was validated and frozen onto the row at create
						// time, so it round-trips back here as a ResolvedPolicy.
						const policy = (run as { paidPolicy: ResolvedPolicy }).paidPolicy
						// Per-run budget, built from that frozen policy plus the system
						// ceiling. The tool handlers charge it before each vendor call,
						// and the loop reads it to halt when spend runs out. The fiber's
						// own connection backs the cap check.
						const budgetLayer = makeBudgetLayer({
							organizationId,
							userId,
							researchId,
							policy,
							systemCeiling: monthlyCapHardCeilingCents,
						}).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient)(sql)))

						// One tool-log + SSE pair per round, so a multi-round run is
						// visible in the run's toolLog and its live stream.
						const emitRound = (
							round: number,
							textLength: number,
							toolCalls: number,
						) =>
							Effect.gen(function* () {
								yield* publishEvent(researchId, 'tool.called', {
									tool: 'llm.generateText',
									phase: 1,
									round,
								})
								yield* Ref.update(toolLog, log => [
									...log,
									{
										timestamp: DateTime.nowUnsafe().toString(),
										type: 'call' as const,
										tool: 'llm.generateText',
										input: { phase: 1, round, query },
									},
									{
										timestamp: DateTime.nowUnsafe().toString(),
										type: 'result' as const,
										tool: 'llm.generateText',
										output: { round, toolCalls, textLength },
									},
								])
								yield* publishEvent(researchId, 'tool.result', {
									tool: 'llm.generateText',
									phase: 1,
									round,
									toolCalls,
									textLength,
								})
							})

						// The reflect-and-retry loop runs under the per-run Budget +
						// ResearchRunContext, resolving the toolkit so paid tools charge
						// this run. `runRound` threads the growing prompt — each round's
						// assistant text and tool results feed the next — and maps the
						// model response into the plain data the loop decides on.
						const phaseOutcome = yield* Effect.gen(function* () {
							const budget = yield* Budget
							const toolkit = yield* researchToolkit
							const scrape = yield* ScrapeProvider

							// Anchor: when the caller handed in the company's own domain, fetch
							// that official site once now so grounding has the right company's
							// page even if the model never navigates there. Best-effort — a
							// refused, unreachable, or empty site just falls back to the model's
							// own searching, and a people directory (LinkedIn) is left to
							// discover_contacts rather than fetched here.
							if (
								anchorHost !== undefined &&
								!isUnsupportedScrapeUrl(`https://${anchorHost}`)
							) {
								yield* Effect.gen(function* () {
									yield* budget.chargeCheap('scrape', SCRAPE_COST_CENTS)
									const page = yield* scrape.scrape({
										url: `https://${anchorHost}`,
										formats: ['markdown'],
									})
									if (
										page.markdown !== undefined &&
										page.markdown.trim().length > 0
									) {
										const hash = urlHashForScrape(page.url)
										scrapeCorpus.push({ urlHash: hash, text: page.markdown })
										seededAnchorHashes.push(hash)
										seededTranscriptParts.push(
											`[scrape_page] ${boundedToolResult({ url: page.url, markdown: page.markdown })}`,
										)
										yield* Effect.logInfo('research.anchor.seeded').pipe(
											Effect.annotateLogs({
												research_id: researchId,
												host: anchorHost,
											}),
										)
									}
								}).pipe(
									Effect.catchCause(cause =>
										Effect.logWarning('research.anchor.seed_failed').pipe(
											Effect.annotateLogs({
												research_id: researchId,
												host: anchorHost,
												cause: Cause.pretty(cause),
											}),
										),
									),
								)
							}

							// One agent pass = a fresh reflect-and-retry loop. Both the initial
							// pass and a refined retry run here, under the SAME budget + toolkit:
							// re-providing the layer would build a fresh MemoMap and reset the
							// per-run spend, letting one run silently pay twice.
							const runPass = (
								basePrompt: string,
								carryTokensIn: number,
								carryTokensOut: number,
							) =>
								Effect.gen(function* () {
									let prompt: Prompt.Prompt = Prompt.make(basePrompt)
									const runRound = (round: number) =>
										Effect.gen(function* () {
											const response = yield* agentLlm.generateText({
												prompt,
												toolkit,
												// Force a tool on the first round so the model can't
												// answer from memory without gathering evidence (which
												// would leave zero sources and fail the grounding gate
												// on a legitimate company); reflect freely after.
												toolChoice: round === 1 ? 'required' : 'auto',
											})
											prompt = Prompt.concat(
												prompt,
												Prompt.fromResponseParts(response.content),
											)
											// Attribute sources only to scrapes that actually returned
											// content this round — read off the tool RESULTS, not the
											// requested calls — so a failed or empty scrape can never
											// count toward grounding; keep the content for the value guard.
											const scrapeUrlHashes: string[] = []
											for (const tr of response.toolResults) {
												if (tr.name === 'scrape_page') {
													const page = tr.result as
														| { url?: unknown; markdown?: unknown }
														| null
														| undefined
													if (
														page != null &&
														typeof page.url === 'string' &&
														typeof page.markdown === 'string' &&
														page.markdown.trim().length > 0
													) {
														scrapeUrlHashes.push(urlHashForScrape(page.url))
														scrapeCorpus.push({
															urlHash: urlHashForScrape(page.url),
															text: page.markdown,
														})
													}
												} else if (tr.name === 'web_search') {
													// A search that returned scraped page content (Firecrawl
													// scrapeOptions) is real fetched evidence — ground on each
													// such result, exactly like a scrape. The sources row was
													// upserted by the search cache when the tool ran.
													const searchResult = tr.result as
														| { items?: ReadonlyArray<unknown> }
														| null
														| undefined
													for (const raw of searchResult?.items ?? []) {
														const item = raw as {
															url?: unknown
															content?: unknown
														}
														if (
															typeof item.url === 'string' &&
															typeof item.content === 'string' &&
															item.content.trim().length > 0
														) {
															scrapeUrlHashes.push(urlHashForScrape(item.url))
															scrapeCorpus.push({
																urlHash: urlHashForScrape(item.url),
																text: item.content,
															})
														}
													}
												}
											}
											const renderedResults = response.toolResults.map(
												tr =>
													`[${tr.name}] ${boundedToolResult(tr.encodedResult ?? tr.result)}`,
											)
											// Record each fetch the model gave up on (a dead URL, a
											// provider 4xx) so the skipped page shows in the run's tool
											// log; the run keeps going and only fails if nothing grounds it.
											for (const tr of response.toolResults) {
												if (!tr.isFailure) continue
												yield* Ref.update(toolLog, log => [
													...log,
													{
														timestamp: DateTime.nowUnsafe().toString(),
														type: 'result' as const,
														tool: tr.name,
														error: boundedToolResult(
															tr.encodedResult ?? tr.result,
														),
													},
												])
											}
											// A registry_lookup that resolved the target by its legal name
											// strongly confirms the run reached the right company, even if
											// its own site was never scraped. OR-accumulate across rounds.
											if (!registryConfirmed) {
												for (const tr of response.toolResults) {
													if (
														!tr.isFailure &&
														tr.name === 'registry_lookup' &&
														isConfirmedRegistryMatch(entityTargets, tr.result)
													) {
														registryConfirmed = true
														break
													}
												}
											}
											yield* emitRound(
												round,
												response.text.length,
												response.toolCalls.length,
											)
											return {
												text: response.text,
												hasToolCalls: response.toolCalls.length > 0,
												scrapeUrlHashes,
												renderedResults,
												promptChars: JSON.stringify(response.content).length,
												inputTokens: response.usage.inputTokens.total ?? 0,
												outputTokens: response.usage.outputTokens.total ?? 0,
											}
										})
									// When the model stops early without the evidence confirming the
									// target, nudge it to find and read the company's own site before
									// finishing; bounded so a run that still cannot ground fails closed.
									let groundingRetries = 0
									const shouldContinueAfterFinal = () =>
										Effect.sync(() => {
											if (entityTargets === null) return false
											if (groundingRetries >= MAX_GROUNDING_RETRIES)
												return false
											const verdict = classifyEntityMatch(
												entityTargets,
												scrapeCorpus.map(page => page.text).join('\n'),
											)
											if (verdict === 'strong') return false
											groundingRetries++
											prompt = Prompt.concat(
												prompt,
												Prompt.make(GROUNDING_RETRY_INSTRUCTION),
											)
											return true
										})
									return yield* runAgentResearchLoop({
										maxSteps: maxAgentSteps,
										maxPromptChars: MAX_LOOP_PROMPT_CHARS,
										maxPromptTokens: maxLoopPromptTokens,
										runRound,
										shouldContinueAfterFinal,
										budgetSnapshot: budget.snapshot(),
										priorTokensIn: carryTokensIn,
										priorTokensOut: carryTokensOut,
									})
								})

							let loop = yield* runPass(
								`${systemPrompt}\n\n${query}${anchorInstruction}`,
								priorTokensIn,
								priorTokensOut,
							)

							// A non-anchored discovery scan (prospect / competitor) that comes
							// back empty gets ONE refined retry before we accept "found
							// nothing": only here does an empty primary list mean the search —
							// not the data — fell short, and only here is the entity gate a
							// no-op. Extraction runs now so the emptiness check sees real
							// structured findings; the retry reuses this pass's budget.
							let findings: unknown
							let refined = false
							let extractOutputTokens = 0
							if (isRetryEligible(schemaName) && entityTargets === null) {
								yield* linkRunSources(loop.scrapedUrlHashes)
								let extracted = yield* extractStructuredFindings(
									loop.researchText,
									[
										loop.evidenceText,
										...scrapeCorpus.map(page => page.text),
									].join('\n'),
								)
								findings = extracted.findings
								extractOutputTokens += extracted.outputTokens
								if (
									isDiscoveryScanEmpty(schemaName, findings) &&
									canAffordAnotherRound(yield* budget.snapshot())
								) {
									refined = true
									yield* Effect.logInfo('research.refining').pipe(
										Effect.annotateLogs({
											research_id: researchId,
											schema: schemaName,
										}),
									)
									yield* publishEvent(researchId, 'run.refining', {
										schema: schemaName,
									})
									const retryLoop = yield* runPass(
										`${systemPrompt}\n\n${query}\n\n${REFINE_HINT}`,
										0,
										0,
									)
									loop = {
										researchText: [loop.researchText, retryLoop.researchText]
											.filter(t => t.length > 0)
											.join('\n\n'),
										evidenceText: [loop.evidenceText, retryLoop.evidenceText]
											.filter(t => t.length > 0)
											.join('\n\n'),
										scrapedUrlHashes: [
											...new Set([
												...loop.scrapedUrlHashes,
												...retryLoop.scrapedUrlHashes,
											]),
										],
										tokensIn: loop.tokensIn + retryLoop.tokensIn,
										tokensOut: loop.tokensOut + retryLoop.tokensOut,
										rounds: loop.rounds + retryLoop.rounds,
										stopReason: retryLoop.stopReason,
									}
									yield* linkRunSources(retryLoop.scrapedUrlHashes)
									extracted = yield* extractStructuredFindings(
										loop.researchText,
										[
											loop.evidenceText,
											...scrapeCorpus.map(page => page.text),
										].join('\n'),
									)
									findings = extracted.findings
									extractOutputTokens += extracted.outputTokens
								}
							}

							return { loop, findings, refined, extractOutputTokens }
						}).pipe(
							Effect.provide(researchToolkitLayer),
							Effect.provide(budgetLayer),
							Effect.provide(Layer.succeed(ResearchRunContext)({ researchId })),
							Effect.withSpan('research.phase1', {
								attributes: { 'research.run_id': researchId },
							}),
						)

						const loopResult = phaseOutcome.loop
						// Prepend the anchor site's content so phase-2 extraction reads the
						// official page first; empty when nothing was seeded.
						researchText = [...seededTranscriptParts, loopResult.researchText]
							.filter(part => part.length > 0)
							.join('\n\n')
						evidenceText = loopResult.evidenceText
						tokensIn = loopResult.tokensIn
						tokensOut = loopResult.tokensOut
						retryFindings = phaseOutcome.findings
						retryExtractTokens = phaseOutcome.extractOutputTokens

						// Entity grounding gate: from the fetched evidence alone (never the
						// model's prose), classify how strongly the pages concern the
						// requested company. Nothing about the target ('absent'), or only a
						// glancing mention of it ('weak'), fails closed now — before phase 2
						// extraction can turn a lookalike's pages into a confident profile.
						// Only a strong match proceeds.
						entityMatch = entityTargets
							? classifyEntityMatch(
									entityTargets,
									[evidenceText, ...scrapeCorpus.map(page => page.text)].join(
										'\n',
									),
								)
							: null
						if (entityMatch === 'absent' || entityMatch === 'weak') {
							yield* failClosedOnEntity(entityMatch)
							return
						}

						yield* sql`
							UPDATE research_runs
							SET phase = 1,
								research_text = ${researchText},
								entity_match = ${entityMatch},
								tokens_in = ${tokensIn},
								tokens_out = ${tokensOut},
								updated_at = now()
							WHERE id = ${researchId}
						`

						// Link every page scraped across the loop's rounds — plus the anchor
						// site seeded before the loop — to the run so findings cite real
						// sources (a discovery-scan retry may have linked some already —
						// ON CONFLICT makes the re-link a no-op).
						yield* linkRunSources([
							...loopResult.scrapedUrlHashes,
							...seededAnchorHashes,
						])
					}

					// The phase-1 entity gate is skipped when a run resumes from a checkpoint
					// (the loop that decides the verdict does not re-run), so re-check the stored
					// verdict here: a weak or absent match fails closed before phase 2 instead of
					// extracting a lookalike's profile on resume.
					if (entityMatch === 'weak' || entityMatch === 'absent') {
						yield* failClosedOnEntity(entityMatch)
						return
					}

					// ── Phase 2: Structured output ──
					// Skipped on resume if findings were already captured.
					let findings: unknown
					if (checkpointPhase >= 2 && existingFindingsHasValue) {
						findings = existingFindings
						yield* Effect.logInfo('research.phase2.resume').pipe(
							Effect.annotateLogs({ research_id: researchId }),
						)
					} else {
						if (retryFindings !== undefined) {
							// The discovery-scan retry path already ran extraction under the
							// shared budget — reuse those findings and their token cost.
							findings = retryFindings
							tokensOut += retryExtractTokens
						} else {
							const extracted = yield* extractStructuredFindings(
								researchText,
								[
									evidenceText,
									...groundedPageTexts(entityTargets, scrapeCorpus),
								].join('\n'),
							)
							findings = extracted.findings
							tokensOut += extracted.outputTokens
						}
						yield* Ref.update(toolLog, log => [
							...log,
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'result' as const,
								tool: 'llm.generateObject',
								output: { schema: schemaName },
							},
						])
						yield* sql`
							UPDATE research_runs
							SET phase = 2,
								findings = ${JSON.stringify(findings)},
								tokens_out = ${tokensOut},
								updated_at = now()
							WHERE id = ${researchId}
						`
					}

					// ── Phase 3: Brief generation ──
					const briefLang = context?.hints?.language ?? 'en'
					const briefMd = yield* Effect.gen(function* () {
						yield* publishEvent(researchId, 'tool.called', {
							tool: 'llm.generateText',
							phase: 3,
							language: briefLang,
						})

						const briefResponse = yield* writerLlm.generateText({
							prompt: `Write a concise human-readable research brief in ${briefLang}, summarizing ONLY the structured findings below. Do not add any fact, number, name, or contact detail that is not present in the findings.\n\n${JSON.stringify(findings)}`,
						})

						tokensOut += briefResponse.usage.outputTokens.total ?? 0

						yield* Ref.update(toolLog, log => [
							...log,
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'result' as const,
								tool: 'llm.generateText',
								output: { phase: 3, briefLength: briefResponse.text.length },
							},
						])

						return briefResponse.text
					}).pipe(
						Effect.withSpan('research.phase3', {
							attributes: {
								'research.run_id': researchId,
								language: briefLang,
							},
						}),
					)

					// ── Persist results ──
					const finalToolLog = yield* Ref.get(toolLog)

					// Grounding gate (fail-closed): a run that fetched no page cannot
					// ground its findings, so it is marked no_reliable_data instead of
					// reporting success with fabricated data. Returns before the cache
					// write and parent merge below, like any run that does not succeed.
					const [sources] = yield* sql<{ n: number }>`
						SELECT COUNT(*)::int AS n FROM research_run_sources
						WHERE research_id = ${researchId}
					`
					if ((sources?.n ?? 0) < MIN_GROUNDED_SOURCES) {
						yield* sql`
							UPDATE research_runs
							SET status = 'no_reliable_data',
								reason_code = ${'no_sources' satisfies ReasonCode},
								phase = 3,
								findings = ${JSON.stringify(
									withRegistryFlag({
										error:
											'No pages were fetched, so the findings could not be grounded.',
										reason: 'no_reliable_data',
									}),
								)},
								tool_log = ${JSON.stringify(finalToolLog)},
								completed_at = now(),
								updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						yield* publishEvent(researchId, 'run.no_reliable_data', {
							sourceCount: sources?.n ?? 0,
						})
						const parentGroupId = (run as { parentId: string | null }).parentId
						if (parentGroupId) yield* rollupParentLocked(parentGroupId)
						return
					}

					// An open-ended discovery scan that came back empty even after a
					// refined retry has no reliable findings to report — mark it
					// no_reliable_data instead of a green success over an empty list.
					if (
						entityTargets === null &&
						isRetryEligible(schemaName) &&
						isDiscoveryScanEmpty(schemaName, findings)
					) {
						yield* sql`
							UPDATE research_runs
							SET status = 'no_reliable_data',
								reason_code = ${'no_sources' satisfies ReasonCode},
								phase = 3,
								findings = ${JSON.stringify({
									error:
										'The search found no companies matching the criteria, even after a refined retry, so there are no reliable findings to report.',
									reason: 'no_reliable_data',
								})},
								tool_log = ${JSON.stringify(finalToolLog)},
								completed_at = now(),
								updated_at = now()
							WHERE id = ${researchId} AND status = 'running'
						`
						yield* publishEvent(researchId, 'run.no_reliable_data', {
							reason: 'no_results',
						})
						const parentGroupId = (run as { parentId: string | null }).parentId
						if (parentGroupId) yield* rollupParentLocked(parentGroupId)
						return
					}

					yield* sql`
						UPDATE research_runs
						SET status = 'succeeded',
							phase = 3,
							findings = ${JSON.stringify(withRegistryFlag(findings as Record<string, unknown>))},
							brief_md = ${briefMd},
							tokens_in = ${tokensIn},
							tokens_out = ${tokensOut},
							tool_log = ${JSON.stringify(finalToolLog)},
							completed_at = now(),
							updated_at = now()
						WHERE id = ${researchId} AND status = 'running'
					`

					// ── Write to research_cache so identical requests can skip the fiber ──
					const cacheKey = computeResearchCacheKey({
						userId,
						query: (run as { query: string }).query,
						schemaName,
						schemaVersion: schemaVersionFor(schemaName),
						subjects: context?.subjects,
						hints: context?.hints,
						templateFingerprint,
					})
					const ttlDays = researchCacheTtlDaysFor(schemaName)
					yield* sql`
						INSERT INTO research_cache (
							key_hash, organization_id, user_id, research_id, cached_at, expires_at
						) VALUES (
							${cacheKey}, ${(run as { organizationId: string }).organizationId}, ${userId}, ${researchId},
							now(), now() + (${`${ttlDays} days`})::interval
						)
						ON CONFLICT (organization_id, key_hash) DO UPDATE SET
							research_id = EXCLUDED.research_id,
							user_id     = EXCLUDED.user_id,
							cached_at   = EXCLUDED.cached_at,
							expires_at  = EXCLUDED.expires_at
					`.pipe(Effect.ignore)

					// Merge findings onto parent group row if this is a leaf
					const parentId = (run as { parentId: string | null }).parentId
					if (parentId) {
						yield* mergeToParent(parentId, findings)
					}

					yield* publishEvent(researchId, 'run.succeeded', {
						tokensIn,
						tokensOut,
					})
				}).pipe(
					// One span covering the whole run, so every phase/tool span nests
					// under it and a failed run points straight at the phase/tool that
					// broke it.
					Effect.withSpan('research.run', {
						attributes: { 'research.run_id': researchId, user_id: userId },
					}),
					// Scope the run so the heartbeat fiber (forked above) is
					// interrupted the moment the run finishes, fails, or is cancelled.
					Effect.scoped,
					Effect.catchCause(cause => {
						if (shouldMarkRunFailed(cause)) {
							return Effect.gen(function* () {
								const detail = Cause.pretty(cause)
								yield* sql`
									UPDATE research_runs
									SET status = 'failed',
										reason_code = ${'internal_error' satisfies ReasonCode},
										findings = ${JSON.stringify({ error: detail })},
										completed_at = now(),
										updated_at = now()
									WHERE id = ${researchId} AND status = 'running'
								`
								yield* publishEvent(researchId, 'run.failed', {
									error: detail,
								})
								// If this leaf belongs to a group, roll the parent up now so
								// an all-failed group resolves instead of hanging in 'running'.
								const [failedParent] = yield* sql<{
									parentId: string | null
								}>`SELECT parent_id FROM research_runs WHERE id = ${researchId}`
								if (failedParent?.parentId)
									yield* rollupParentLocked(failedParent.parentId)
							})
						}
						// Pure interrupt (cancel/shutdown): propagate it; the cancel
						// path sets the status itself, so don't overwrite it.
						return Effect.interrupt
					}),
					Effect.annotateLogs({
						research_id: researchId,
						user_id: userId,
						event: 'research.fiber',
					}),
				)

			// ── Dispatch ──
			// Three layer-scoped daemons: the reconcile re-offers committed queued
			// runs, a periodic sweep fails runs whose worker died (stale heartbeat),
			// and the consumer drains the queue and runs each job on the layer fiber's
			// clean services — never a request's committed connection. Runs fork into
			// the layer scope so a shutdown interrupts them; the periodic sweep then
			// reclaims their rows. A failure in any is logged, not fatal.
			const layerScope = yield* Effect.scope
			yield* reofferQueued.pipe(
				Effect.catchCause(cause =>
					Effect.logError('research.dispatch: reconcile failed').pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
				Effect.repeat(Schedule.spaced('2 seconds')),
				Effect.forkScoped,
			)
			yield* Effect.gen(function* () {
				const swept = yield* sweepOrphanRuns(ORPHAN_AGE_SECONDS)
				if (swept.running.length > 0) {
					yield* Effect.logWarning(
						'research.sweepOrphans: failed runs orphaned mid-run',
					).pipe(
						Effect.annotateLogs({
							running_count: swept.running.length,
							running_ids: swept.running.map(r => r.id),
						}),
					)
				}
			}).pipe(
				Effect.catchCause(cause =>
					Effect.logError('research.dispatch: sweep failed').pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
				Effect.repeat(Schedule.spaced(`${orphanSweepIntervalSeconds} seconds`)),
				Effect.forkScoped,
			)
			yield* Queue.take(dispatch).pipe(
				Effect.flatMap(({ researchId, userId }) =>
					Effect.gen(function* () {
						// Skip a run already in flight: the reconcile re-offers queued
						// rows, so the same run can arrive twice. (The guarded claim is
						// the final backstop; this just avoids a redundant fiber.)
						const inFlight = yield* Ref.get(activeFibers)
						if (HashMap.has(inFlight, researchId)) return
						const fiber = yield* fiberSem
							.withPermit(userId)(runFiber(researchId, userId))
							.pipe(
								Effect.ensuring(cleanupRun(researchId)),
								Effect.forkIn(layerScope),
							)
						yield* Ref.update(activeFibers, m =>
							HashMap.set(m, researchId, fiber),
						)
					}),
				),
				Effect.catchCause(cause =>
					Effect.logError('research.dispatch: failed to start run').pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
				Effect.forever,
				Effect.forkScoped,
			)

			return {
				/** Create a research run, enqueue it, and return the run id. */
				create: (
					userId: string,
					organizationId: string,
					input: CreateResearchInput,
					systemDefaults: SystemDefaults,
					instructions?: ResolvedInstructions,
				) =>
					Effect.gen(function* () {
						yield* Effect.logInfo('research.create').pipe(
							Effect.annotateLogs({
								user_id: userId,
								organization_id: organizationId,
								query_length: input.query.length,
								schema: input.schemaName ?? 'freeform',
								mode: input.mode ?? 'deep',
								has_subjects: !!input.context?.subjects?.length,
								has_selector: !!input.context?.selector,
							}),
						)

						// ── Outer research-run cache check ──
						// Identical (user, query, schema, subjects, hints, templates)
						// within TTL returns immediately without forking a fiber.
						// `forceFresh` overrides this and always executes.
						// Instructions are resolved by the app layer (empty when no
						// templates apply). The fingerprint enters the cache key so an
						// edited/swapped stack can't serve a stale run; the same value
						// is threaded to the forked fiber for the write-back key.
						const segments = instructions?.segments ?? []
						const templateFingerprint = instructions?.fingerprint ?? ''
						const templateIds = instructions?.templateIds ?? []
						const templateNames = instructions?.templateNames ?? []
						const schemaNameForKey = input.schemaName ?? 'freeform'
						const cacheKey = computeResearchCacheKey({
							userId,
							query: input.query,
							schemaName: schemaNameForKey,
							schemaVersion: schemaVersionFor(schemaNameForKey),
							subjects: input.context?.subjects,
							hints: input.context?.hints,
							templateFingerprint,
						})
						if (!input.forceFresh) {
							const hits = yield* sql<{ research_id: string }>`
								SELECT research_id
								FROM research_cache
								WHERE key_hash = ${cacheKey}
									AND organization_id = ${organizationId}
									AND user_id = ${userId}
									AND expires_at > now()
								LIMIT 1
							`
							if (hits[0]) {
								const cachedId = hits[0].research_id
								const [cachedRun] = yield* sql<{
									findings: unknown
									brief_md: string | null
									tokens_in: number
									tokens_out: number
								}>`
									SELECT findings, brief_md, tokens_in, tokens_out
									FROM research_runs
									WHERE id = ${cachedId} AND status = 'succeeded'
									LIMIT 1
								`
								if (cachedRun) {
									const clonedRows = yield* sql<{ id: string }>`
										INSERT INTO research_runs (
											organization_id,
											query, mode, schema_name, kind, status, context,
											findings, brief_md,
											tokens_in, tokens_out,
											cost_cents, paid_cost_cents,
											idempotency_key, created_by,
											template_ids, template_names, template_fingerprint,
											started_at, completed_at
										) VALUES (
											${organizationId},
											${input.query},
											${input.mode ?? 'deep'},
											${input.schemaName ?? null},
											'cache_hit',
											'succeeded',
											${JSON.stringify(input.context ?? {})},
											${JSON.stringify(cachedRun.findings)},
											${cachedRun.brief_md},
											${cachedRun.tokens_in},
											${cachedRun.tokens_out},
											0, 0,
											${input.idempotencyKey ?? null},
											${userId},
											${JSON.stringify(templateIds)}, ${JSON.stringify(templateNames)}, ${templateFingerprint},
											now(), now()
										) RETURNING id
									`
									const cloned = clonedRows[0]
									if (!cloned)
										return { id: cachedId, status: 'succeeded' as const }
									const clonedId = cloned.id
									// Clone source attributions from the cached run.
									// research_run_sources / research_links are RLS-checked
									// against `current_setting('app.current_org_id')`, so the
									// org id has to be in the row, not just on the parent run.
									yield* sql`
										INSERT INTO research_run_sources (organization_id, research_id, source_id, local_ref, fetched_at, cost_cents)
										SELECT ${organizationId}, ${clonedId}, source_id, local_ref, fetched_at, 0
										FROM research_run_sources
										WHERE research_id = ${cachedId}
										ON CONFLICT DO NOTHING
									`
									if (input.context?.subjects) {
										for (const s of input.context.subjects) {
											yield* sql`
												INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
												VALUES (${organizationId}, ${clonedId}, ${s.table}, ${s.id}, 'input')
												ON CONFLICT DO NOTHING
											`
										}
									}
									yield* Effect.logInfo('research.cache_hit').pipe(
										Effect.annotateLogs({
											user_id: userId,
											research_id: clonedId,
											source_research_id: cachedId,
										}),
									)
									return { id: clonedId, status: 'succeeded' as const }
								}
							}
						}

						// Resolve policy
						const policy = yield* resolvePolicy({
							sql,
							userId,
							systemDefaults,
							perRunOverrides: {
								budgetCents: input.budgetCents,
								paidBudgetCents: input.paidBudgetCents,
								autoApprovePaidCents: input.autoApprovePaidCents,
							},
						})

						// A selector fans the run out across matching companies: one
						// group parent plus a leaf run per company, sharing this run's
						// policy and instructions. The group's status rolls up from the
						// leaves as they finish. This runs after (and instead of) the
						// cache check above — a fan-out is not one cacheable result.
						const selector = input.context?.selector
						if (selector) {
							const selectorMax = selectorMaxCompanies

							// Resolve targets from a safe subset of company columns — never
							// raw SQL, so the filter can't inject.
							const filter = selector.filter as {
								status?: string
								industry?: string
								region?: string
								tags?: ReadonlyArray<string>
							}
							const conds: Array<
								import('effect/unstable/sql').Statement.Fragment
							> = [
								sql`organization_id = ${organizationId}`,
								sql`deleted_at IS NULL`,
							]
							if (filter.status) conds.push(sql`status = ${filter.status}`)
							if (filter.industry)
								conds.push(sql`industry = ${filter.industry}`)
							if (filter.region) conds.push(sql`region = ${filter.region}`)
							if (filter.tags && filter.tags.length > 0)
								conds.push(sql`tags && ${filter.tags}`)

							// Fetch one past the cap so a truncated fan-out is visible.
							const matched = yield* sql<{ id: string }>`
								SELECT id FROM companies
								WHERE ${sql.and(conds)}
								ORDER BY created_at
								LIMIT ${selectorMax + 1}
							`
							const capped = matched.length > selectorMax
							const targets = capped ? matched.slice(0, selectorMax) : matched
							if (capped) {
								yield* Effect.logWarning('research.selector.capped').pipe(
									Effect.annotateLogs({
										user_id: userId,
										matched: matched.length,
										cap: selectorMax,
									}),
								)
							}

							// Fan-out cost gate: a selector launches one run per matched
							// company, so a caller that hasn't set `confirm` gets the
							// scale back first and re-submits with `confirm: true` once the
							// count is acceptable. Nothing has been written yet, so
							// returning here leaves no partial group behind. The estimate
							// is the paid-data ceiling summed across the fan-out.
							if (targets.length > 0 && input.confirm !== true) {
								yield* Effect.logInfo(
									'research.selector.confirm_required',
								).pipe(
									Effect.annotateLogs({
										user_id: userId,
										subject_count: targets.length,
									}),
								)
								return {
									status: 'confirm_required' as const,
									subjectCount: targets.length,
									estimatedCostCents: targets.length * policy.paidBudgetCents,
								}
							}

							// The group is 'running' with no heartbeat/started_at, so the
							// orphan sweep (which only reclaims stale 'running' rows) never
							// touches it, and it is never dispatched or run itself.
							const [groupRow] = yield* sql<{ id: string }>`
								INSERT INTO research_runs (
									organization_id, query, mode, schema_name, kind, status,
									context, budget_cents, paid_budget_cents, paid_policy,
									created_by, template_ids, template_names,
									template_fingerprint, instruction_segments
								) VALUES (
									${organizationId}, ${input.query}, ${input.mode ?? 'deep'},
									${input.schemaName ?? null}, 'group', 'running',
									${JSON.stringify(input.context ?? {})},
									${policy.budgetCents}, ${policy.paidBudgetCents},
									${JSON.stringify(policy)}, ${userId},
									${JSON.stringify(templateIds)}, ${JSON.stringify(templateNames)},
									${templateFingerprint}, ${JSON.stringify(segments)}
								) RETURNING id
							`
							const groupId = (groupRow as { id: string }).id

							yield* Effect.forEach(targets, company =>
								Effect.gen(function* () {
									// The leaf researches one company; it inherits the hints
									// but not the selector, so it runs as an ordinary subject.
									const leafContext = {
										...(input.context ?? {}),
										selector: undefined,
										subjects: [{ table: 'companies' as const, id: company.id }],
									}
									const [leafRow] = yield* sql<{ id: string }>`
										INSERT INTO research_runs (
											organization_id, parent_id, query, mode, schema_name,
											kind, status, context, budget_cents, paid_budget_cents,
											paid_policy, created_by, template_ids, template_names,
											template_fingerprint, instruction_segments
										) VALUES (
											${organizationId}, ${groupId}, ${input.query},
											${input.mode ?? 'deep'}, ${input.schemaName ?? null},
											'leaf', 'queued', ${JSON.stringify(leafContext)},
											${policy.budgetCents}, ${policy.paidBudgetCents},
											${JSON.stringify(policy)}, ${userId},
											${JSON.stringify(templateIds)},
											${JSON.stringify(templateNames)},
											${templateFingerprint}, ${JSON.stringify(segments)}
										) RETURNING id
									`
									const leafId = (leafRow as { id: string }).id
									yield* sql`
										INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
										VALUES (${organizationId}, ${leafId}, 'companies', ${company.id}, 'input')
										ON CONFLICT DO NOTHING
									`
									const leafPubsub = yield* PubSub.unbounded<ResearchEvent>()
									yield* Ref.update(activePubSubs, m =>
										HashMap.set(m, leafId, leafPubsub),
									)
									yield* Queue.offer(dispatch, { researchId: leafId, userId })
								}),
							)

							// Set the group's initial status from its leaves (and resolve it
							// straight away when the selector matched nothing).
							yield* rollupParentLocked(groupId)

							yield* Effect.logInfo('research.selector.fanout').pipe(
								Effect.annotateLogs({
									user_id: userId,
									group_id: groupId,
									leaves: targets.length,
								}),
							)
							return { id: groupId, status: 'running' as const }
						}

						// Insert the run row
						const [row] = yield* sql`
							INSERT INTO research_runs (
								organization_id,
								query, mode, schema_name, status, context,
								budget_cents, paid_budget_cents,
								paid_policy, idempotency_key, created_by,
								template_ids, template_names, template_fingerprint,
								instruction_segments
							) VALUES (
								${organizationId},
								${input.query},
								${input.mode ?? 'deep'},
								${input.schemaName ?? null},
								'queued',
								${JSON.stringify(input.context ?? {})},
								${policy.budgetCents},
								${policy.paidBudgetCents},
								${JSON.stringify(policy)},
								${input.idempotencyKey ?? null},
								${userId},
								${JSON.stringify(templateIds)},
								${JSON.stringify(templateNames)},
								${templateFingerprint},
								${JSON.stringify(segments)}
							) RETURNING id
						`
						const researchId = (row as { id: string }).id

						// Link input subjects. research_links is RLS-checked against
						// the per-row organization_id, so the column has to be set.
						if (input.context?.subjects) {
							for (const s of input.context.subjects) {
								yield* sql`
									INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
									VALUES (${organizationId}, ${researchId}, ${s.table}, ${s.id}, 'input')
									ON CONFLICT DO NOTHING
								`
							}
						}

						// Create PubSub for SSE streaming
						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, researchId, pubsub),
						)

						// The row is queued; the dispatch consumer runs it on the
						// service's own connection once a concurrency slot frees.
						// Running it on this request's fiber would reuse the request
						// transaction's connection — already committed by the time
						// the job writes its first cache row.
						yield* Queue.offer(dispatch, { researchId, userId })

						return { id: researchId, status: 'queued' as const }
					}),

				/** Get a research run by id. Groups include children inline. */
				get: (researchId: string) =>
					Effect.gen(function* () {
						const [run] = yield* sql`
							-- A failed run keeps its error text inside findings; lift it out
							-- so the detail view can show why the run failed.
							SELECT r.*, r.findings->>'error' AS error_message,
								COALESCE(
									(SELECT json_agg(json_build_object(
										'source_id', rs.source_id,
										'local_ref', rs.local_ref,
										'fetched_at', rs.fetched_at,
										'cost_cents', rs.cost_cents,
										'source', json_build_object(
											'id', s.id,
											'kind', s.kind,
											'provider', s.provider,
											'url', s.url,
											'title', s.title,
											'domain', s.domain,
											'content_hash', s.content_hash,
											'content_ref', s.content_ref
										)
									))
									FROM research_run_sources rs
									JOIN sources s ON s.id = rs.source_id
									WHERE rs.research_id = r.id),
									'[]'::json
								) AS sources,
								COALESCE(
									(SELECT json_agg(json_build_object(
										'subject_table', rl.subject_table,
										'subject_id', rl.subject_id,
										'link_kind', rl.link_kind
									))
									FROM research_links rl
									WHERE rl.research_id = r.id),
									'[]'::json
								) AS links,
								CASE WHEN r.kind = 'group' THEN
									COALESCE(
										(SELECT json_agg(json_build_object(
											'id', c.id,
											'kind', c.kind,
											'status', c.status,
											'query', c.query,
											'findings', c.findings,
											'brief_md', c.brief_md,
											'cost_cents', c.cost_cents,
											'completed_at', c.completed_at
										) ORDER BY c.created_at)
										FROM research_runs c
										WHERE c.parent_id = r.id AND c.status != 'deleted'),
										'[]'::json
									)
								ELSE '[]'::json END AS children
							FROM research_runs r
							WHERE r.id = ${researchId} AND r.status != 'deleted'
						`
						return run ?? null
					}),

				/** List research runs with filters. */
				list: (filters: {
					createdBy?: string | undefined
					status?: string | undefined
					subjectTable?: string | undefined
					subjectId?: string | undefined
					since?: string | undefined
					limit?: number | undefined
					offset?: number | undefined
				}) =>
					Effect.gen(function* () {
						const conditions: Array<
							import('effect/unstable/sql').Statement.Fragment
						> = [sql`r.status != 'deleted'`]
						if (filters.createdBy)
							conditions.push(sql`r.created_by = ${filters.createdBy}`)
						if (filters.status)
							conditions.push(sql`r.status = ${filters.status}`)
						if (filters.since)
							conditions.push(sql`r.created_at >= ${filters.since}`)

						if (filters.subjectTable && filters.subjectId) {
							conditions.push(sql`EXISTS (
								SELECT 1 FROM research_links rl
								WHERE rl.research_id = r.id
								  AND rl.subject_table = ${filters.subjectTable}
								  AND rl.subject_id = ${filters.subjectId}
							)`)
						}

						// Clamp pagination before it reaches SQL (see clampPagination).
						const { limit, offset } = clampPagination(
							filters.limit,
							filters.offset,
						)

						return yield* sql`
							SELECT r.id, r.kind, r.query, r.mode, r.schema_name,
								r.status, r.cost_cents, r.paid_cost_cents,
								r.created_by, r.created_at, r.completed_at
							FROM research_runs r
							WHERE ${sql.and(conditions)}
							ORDER BY r.created_at DESC
							LIMIT ${limit}
							OFFSET ${offset}
						`
					}),

				/** Pending proposed updates across the org, for the review inbox. */
				listPendingProposals: (filters: {
					subjectTable?: string | undefined
					status?: string | undefined
					minConfidence?: number | undefined
					machineCheckable?: boolean | undefined
					limit?: number | undefined
					offset?: number | undefined
				}) => queryPendingProposals(sql, filters),

				/** Get all runs linked to a subject row. */
				bySubject: (table: string, id: string) =>
					sql`
						SELECT r.id, r.kind, r.query, r.mode, r.schema_name,
							r.status, r.cost_cents, r.created_at, r.completed_at
						FROM research_runs r
						JOIN research_links rl ON rl.research_id = r.id
						WHERE rl.subject_table = ${table}
						  AND rl.subject_id = ${id}
						  AND r.status != 'deleted'
						ORDER BY r.created_at DESC
					`,

				// Aggregates research_paid_spend rows for the current org.
				// `range` clamps the time window (defaults to "all"); `groupBy`
				// chooses which dimension to bucket by. The org_isolation_*
				// policy on research_paid_spend already filters cross-org rows
				// because OrgMiddleware sets app.current_org_id at the edge,
				// so the WHERE clause only needs the time bound.
				spend: (filters: {
					range?: 'month' | '30d' | 'all'
					groupBy?: 'provider' | 'user' | 'tool'
				}) =>
					Effect.gen(function* () {
						const groupBy = filters.groupBy ?? 'provider'
						const range = filters.range ?? 'all'

						const sinceFragment =
							range === 'month'
								? sql`AND at >= date_trunc('month', now())`
								: range === '30d'
									? sql`AND at >= now() - interval '30 days'`
									: sql``

						const keyFragment =
							groupBy === 'user'
								? sql`user_id`
								: groupBy === 'tool'
									? sql`tool`
									: sql`provider`

						return yield* sql`
							SELECT ${keyFragment} AS key,
								SUM(amount_cents)::int AS amount_cents,
								COUNT(*)::int AS calls
							FROM research_paid_spend
							WHERE 1=1 ${sinceFragment}
							GROUP BY ${keyFragment}
							ORDER BY amount_cents DESC
						`
					}),

				/** Subscribe to SSE events for a run. Returns a Stream. */
				subscribe: (researchId: string) =>
					Effect.gen(function* () {
						const map = yield* Ref.get(activePubSubs)
						const maybePubSub = HashMap.get(map, researchId)
						if (maybePubSub._tag === 'None') return null
						return Stream.fromPubSub(maybePubSub.value)
					}),

				/** Cancel a running research fiber. */
				cancel: (researchId: string) =>
					Effect.gen(function* () {
						yield* Effect.logInfo('research.cancel').pipe(
							Effect.annotateLogs({ research_id: researchId }),
						)
						const map = yield* Ref.get(activeFibers)
						const maybeFiber = HashMap.get(map, researchId)
						if (maybeFiber._tag === 'Some') {
							yield* Fiber.interrupt(maybeFiber.value)
						}
						// RETURNING tells us whether a queued/running row actually
						// flipped, so the caller can tell a real cancel apart from a
						// no-op on a missing or already-finished run.
						const [cancelled] = yield* sql<{ id: string }>`
							UPDATE research_runs
							SET status = 'cancelled', completed_at = now(), updated_at = now()
							WHERE id = ${researchId} AND status IN ('queued', 'running')
							RETURNING id
						`
						const flipped = cancelled !== undefined
						if (flipped) {
							yield* publishEvent(researchId, 'run.cancelled', {})
							return { outcome: cancelOutcome(true, true) }
						}
						// Nothing flipped: tell an already-finished run apart from one
						// that doesn't exist at all.
						const [existing] = yield* sql<{ id: string }>`
							SELECT id FROM research_runs
							WHERE id = ${researchId} AND status != 'deleted'
							LIMIT 1
						`
						return { outcome: cancelOutcome(false, existing !== undefined) }
					}),

				/** Soft-delete a research run. */
				softDelete: (researchId: string) =>
					sql`
						UPDATE research_runs
						SET status = 'deleted', updated_at = now()
						WHERE id = ${researchId}
					`,

				/** Post-hoc attach a subject to a run. */
				attach: (
					organizationId: string,
					researchId: string,
					subjectTable: 'companies' | 'contacts',
					subjectId: string,
				) =>
					Effect.gen(function* () {
						// Guard against orphan links: the subject row must exist and
						// belong to this org before we record the link. Branch on the
						// (enum-constrained) table so its name is always a literal,
						// never interpolated into the statement.
						const subjectLookup =
							subjectTable === 'companies'
								? sql<{ id: string }>`
									SELECT id FROM companies
									WHERE id = ${subjectId}
									  AND organization_id = ${organizationId}
									  AND deleted_at IS NULL
									LIMIT 1
								`
								: sql<{ id: string }>`
									SELECT id FROM contacts
									WHERE id = ${subjectId}
									  AND organization_id = ${organizationId}
									  AND deleted_at IS NULL
									LIMIT 1
								`
						const [subject] = yield* subjectLookup
						// Skip the run lookup when the subject is already missing.
						if (!subject) return { outcome: attachOutcome(false, false) }

						// The run must exist under this org as well.
						const [run] = yield* sql<{ id: string }>`
							SELECT id FROM research_runs
							WHERE id = ${researchId}
							  AND organization_id = ${organizationId}
							  AND status != 'deleted'
							LIMIT 1
						`
						const outcome = attachOutcome(true, run !== undefined)
						if (outcome === 'attached') {
							yield* sql`
								INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
								VALUES (${organizationId}, ${researchId}, ${subjectTable}, ${subjectId}, 'finding')
								ON CONFLICT DO NOTHING
							`
						}
						return { outcome }
					}),

				/**
				 * Approve a pending paid action: spawn a follow-up run that performs
				 * the paid call and merges its result onto the origin run. Idempotent —
				 * a re-approve returns the follow-up already spawned rather than
				 * charging again.
				 */
				/**
				 * Re-run a run that grounded on the wrong company, locking onto a
				 * human-supplied correct official domain. Reuses the origin's inputs and
				 * frozen policy, seeding context.anchorDomain so the grounding path treats
				 * that site as authoritative. A clean top-level run, not a child of origin.
				 */
				rerun: (
					userId: string,
					organizationId: string,
					originRunId: string,
					domain: string,
				) =>
					Effect.gen(function* () {
						const host = domainHost(domain)
						if (host === undefined) return { status: 'invalid_domain' as const }
						const [origin] = yield* sql<{
							query: string
							mode: string | null
							schemaName: string | null
							context: unknown
							budgetCents: number
							paidBudgetCents: number
							paidPolicy: string | null
							templateIds: unknown
							templateNames: unknown
							templateFingerprint: string | null
							instructionSegments: unknown
						}>`
							SELECT query, mode, schema_name AS "schemaName", context,
								budget_cents AS "budgetCents",
								paid_budget_cents AS "paidBudgetCents",
								paid_policy::text AS "paidPolicy",
								template_ids AS "templateIds",
								template_names AS "templateNames",
								template_fingerprint AS "templateFingerprint",
								instruction_segments AS "instructionSegments"
							FROM research_runs
							WHERE id = ${originRunId} AND organization_id = ${organizationId}
							LIMIT 1
						`
						if (!origin) return { status: 'run_not_found' as const }

						const originContext =
							origin.context != null && typeof origin.context === 'object'
								? (origin.context as Record<string, unknown>)
								: {}
						const mergedContext: Record<string, unknown> = {
							...originContext,
							anchorDomain: host,
						}

						const [row] = yield* sql<{ id: string }>`
							INSERT INTO research_runs (
								organization_id,
								query, mode, schema_name, status, context,
								budget_cents, paid_budget_cents,
								paid_policy, idempotency_key, created_by,
								template_ids, template_names, template_fingerprint,
								instruction_segments
							) VALUES (
								${organizationId},
								${origin.query},
								${origin.mode ?? 'deep'},
								${origin.schemaName},
								'queued',
								${JSON.stringify(mergedContext)},
								${origin.budgetCents},
								${origin.paidBudgetCents},
								${origin.paidPolicy ?? '{}'}::jsonb,
								${null},
								${userId},
								${JSON.stringify(origin.templateIds ?? [])},
								${JSON.stringify(origin.templateNames ?? [])},
								${origin.templateFingerprint ?? ''},
								${JSON.stringify(origin.instructionSegments ?? [])}
							) RETURNING id
						`
						const researchId = (row as { id: string }).id

						// Re-link the origin's input subjects onto the new run.
						const subjects = Array.isArray(mergedContext['subjects'])
							? (mergedContext['subjects'] as Array<{
									table?: unknown
									id?: unknown
								}>)
							: []
						for (const s of subjects) {
							if (
								(s.table === 'companies' || s.table === 'contacts') &&
								typeof s.id === 'string'
							) {
								yield* sql`
									INSERT INTO research_links (organization_id, research_id, subject_table, subject_id, link_kind)
									VALUES (${organizationId}, ${researchId}, ${s.table}, ${s.id}, 'input')
									ON CONFLICT DO NOTHING
								`
							}
						}

						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, researchId, pubsub),
						)
						yield* Queue.offer(dispatch, { researchId, userId })
						return { status: 'started' as const, id: researchId }
					}),

				approvePaidAction: (runId: string, paId: string, userId: string) =>
					Effect.gen(function* () {
						const [origin] = yield* sql<{
							findings: string | null
							organizationId: string
							paidPolicy: string | null
							createdBy: string | null
						}>`
							SELECT findings::text AS findings, organization_id,
								paid_policy::text AS paid_policy, created_by
							FROM research_runs WHERE id = ${runId}
						`
						if (!origin) return { status: 'run_not_found' as const }
						const findings = (
							origin.findings ? JSON.parse(origin.findings) : null
						) as {
							pending_paid_actions?: Array<Record<string, unknown>>
						} | null
						const actions = findings?.pending_paid_actions ?? []
						const index = actions.findIndex(a => a['id'] === paId)
						if (index === -1) return { status: 'action_not_found' as const }
						const action = actions[index] as Record<string, unknown>
						const existing = action['followup_run_id']
						if (typeof existing === 'string')
							return { status: 'approved' as const, followup_run_id: existing }
						if (action['status'] !== 'pending')
							return { status: 'not_pending' as const }
						if (action['tool'] !== 'registry_lookup')
							return { status: 'unsupported_tool' as const }

						const paidPolicy = origin.paidPolicy
							? (JSON.parse(origin.paidPolicy) as {
									budgetCents?: number
									paidBudgetCents?: number
								})
							: {}
						const followupContext = {
							paid_action: {
								tool: action['tool'],
								args: action['args'] ?? {},
								origin_run_id: runId,
								action_id: paId,
							},
						}
						const [followup] = yield* sql<{ id: string }>`
							INSERT INTO research_runs (
								organization_id, parent_id, query, mode, kind, status, context,
								budget_cents, paid_budget_cents, paid_policy, created_by
							) VALUES (
								${origin.organizationId}, ${runId}, 'paid follow-up', 'deep',
								'followup', 'queued', ${JSON.stringify(followupContext)},
								${paidPolicy.budgetCents ?? 0}, ${paidPolicy.paidBudgetCents ?? 0},
								${origin.paidPolicy ?? '{}'}::jsonb, ${origin.createdBy ?? userId}
							) RETURNING id
						`
						const followupId = (followup as { id: string }).id
						yield* sql`
							UPDATE research_runs SET findings = jsonb_set(
								jsonb_set(
									findings,
									${`{pending_paid_actions,${index},status}`}::text[],
									'"approved"'::jsonb
								),
								${`{pending_paid_actions,${index},followup_run_id}`}::text[],
								${JSON.stringify(followupId)}::jsonb
							), updated_at = now() WHERE id = ${runId}
						`
						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, followupId, pubsub),
						)
						yield* Queue.offer(dispatch, {
							researchId: followupId,
							userId: origin.createdBy ?? userId,
						})
						return { status: 'approved' as const, followup_run_id: followupId }
					}),

				/** Skip a pending paid action: record the decision, spend nothing. */
				skipPaidAction: (runId: string, paId: string) =>
					Effect.gen(function* () {
						const [origin] = yield* sql<{ findings: string | null }>`
							SELECT findings::text AS findings FROM research_runs WHERE id = ${runId}
						`
						if (!origin) return { status: 'run_not_found' as const }
						const findings = (
							origin.findings ? JSON.parse(origin.findings) : null
						) as {
							pending_paid_actions?: Array<Record<string, unknown>>
						} | null
						const actions = findings?.pending_paid_actions ?? []
						const index = actions.findIndex(a => a['id'] === paId)
						if (index === -1) return { status: 'action_not_found' as const }
						yield* sql`
							UPDATE research_runs SET findings = jsonb_set(
								findings,
								${`{pending_paid_actions,${index},status}`}::text[],
								'"skipped"'::jsonb
							), updated_at = now() WHERE id = ${runId}
						`
						return { status: 'skipped' as const }
					}),

				/** Get user's research policy. */
				getPolicy: (userId: string) =>
					Effect.gen(function* () {
						const [row] = yield* sql`
							SELECT * FROM user_research_policy WHERE user_id = ${userId}
						`
						return row ?? null
					}),

				/** Update user's research policy. */
				updatePolicy: (
					userId: string,
					fields: {
						budgetCents?: number | undefined
						paidBudgetCents?: number | undefined
						autoApprovePaidCents?: number | undefined
						paidMonthlyCapCents?: number | undefined
						autoApplyMinConfidence?: number | null | undefined
					},
				) =>
					sql`
						INSERT INTO user_research_policy (user_id, budget_cents, paid_budget_cents, auto_approve_paid_cents, paid_monthly_cap_cents, auto_apply_min_confidence, updated_at)
						VALUES (
							${userId},
							${fields.budgetCents ?? 100},
							${fields.paidBudgetCents ?? 500},
							${fields.autoApprovePaidCents ?? 200},
							${fields.paidMonthlyCapCents ?? 2000},
							${fields.autoApplyMinConfidence ?? null},
							now()
						)
						ON CONFLICT (user_id) DO UPDATE SET
							budget_cents = COALESCE(${fields.budgetCents ?? null}, user_research_policy.budget_cents),
							paid_budget_cents = COALESCE(${fields.paidBudgetCents ?? null}, user_research_policy.paid_budget_cents),
							auto_approve_paid_cents = COALESCE(${fields.autoApprovePaidCents ?? null}, user_research_policy.auto_approve_paid_cents),
							paid_monthly_cap_cents = COALESCE(${fields.paidMonthlyCapCents ?? null}, user_research_policy.paid_monthly_cap_cents),
							-- Nullable on purpose: passing null turns auto-apply off, so a
							-- provided value (even null) is honored while an omitted one keeps
							-- the current setting.
							auto_apply_min_confidence = CASE
								WHEN ${fields.autoApplyMinConfidence !== undefined}
								THEN ${fields.autoApplyMinConfidence ?? null}
								ELSE user_research_policy.auto_apply_min_confidence
							END,
							updated_at = now()
						RETURNING *
					`,

				/** Mark orphaned running + queued rows as failed. */
				sweepOrphans: (maxAgeSeconds: number) => sweepOrphanRuns(maxAgeSeconds),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
