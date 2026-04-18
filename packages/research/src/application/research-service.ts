import { createHash } from 'node:crypto'

import {
	Config,
	DateTime,
	Effect,
	Fiber,
	HashMap,
	Layer,
	PartitionedSemaphore,
	PubSub,
	Ref,
	ServiceMap,
	Stream,
} from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import type { ResolvedPolicy } from '../domain/types'
import { resolvePolicy, type SystemDefaults } from './policy'
import {
	AgentLanguageModel,
	ExtractLanguageModel,
	ResearchEventSink,
	WriterLanguageModel,
} from './ports'
import { type FreeformSchema, schemaRegistry } from './schemas/index'
import { researchToolkit } from './tools'

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

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
}): string => {
	const sortedSubjects = [...(args.subjects ?? [])]
		.map(s => `${s.table}:${s.id}`)
		.sort()
		.join(',')
	const hintsJson = stableStringify(args.hints ?? {})
	return sha256Hex(
		`${args.userId}|${normalizeResearchQuery(args.query)}|${args.schemaName}|${args.schemaVersion}|${sortedSubjects}|${hintsJson}`,
	)
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

// ── ResearchService ──

export class ResearchService extends ServiceMap.Service<ResearchService>()(
	'ResearchService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const agentLlm = yield* AgentLanguageModel
			const extractLlm = yield* ExtractLanguageModel
			const writerLlm = yield* WriterLanguageModel
			// Resolve the toolkit + handlers once at layer-build time so the
			// forked research fiber does not carry `HandlersFor<Tools>` as a
			// lingering context requirement.
			const toolkit = yield* researchToolkit

			const ORPHAN_AGE_SECONDS = 900

			// Reclaim runs that cannot progress after a server restart:
			// 'running' rows whose fiber vanished mid-execution, and 'queued'
			// rows whose in-memory permit-wait slot vanished.
			const sweepOrphanRuns = (maxAgeSeconds: number) =>
				Effect.gen(function* () {
					// COALESCE guards NULL findings: jsonb_set(NULL, …) returns
					// NULL, which would silently drop the error field on rows
					// that never wrote findings (newly-queued rows especially).
					const running = yield* sql<{ id: string }>`
						UPDATE research_runs
						SET status = 'failed',
							findings = jsonb_set(COALESCE(findings, '{}'::jsonb), '{error}', '"server restarted mid-run"'),
							completed_at = now(),
							updated_at = now()
						WHERE status = 'running'
						  AND started_at < now() - interval '1 second' * ${maxAgeSeconds}
						RETURNING id
					`
					// Queued rows have no started_at — the fiber never reached
					// the status-to-running flip. Fall back to created_at.
					const queued = yield* sql<{ id: string }>`
						UPDATE research_runs
						SET status = 'failed',
							findings = jsonb_set(COALESCE(findings, '{}'::jsonb), '{error}', '"server restarted before fiber started"'),
							completed_at = now(),
							updated_at = now()
						WHERE status = 'queued'
						  AND created_at < now() - interval '1 second' * ${maxAgeSeconds}
						RETURNING id
					`
					return { running, queued }
				}).pipe(sql.withTransaction)

			// ── Startup sweep ──
			const swept = yield* sweepOrphanRuns(ORPHAN_AGE_SECONDS)
			if (swept.running.length > 0 || swept.queued.length > 0) {
				yield* Effect.logWarning(
					'research.sweepOrphans: marked orphaned runs as failed',
				).pipe(
					Effect.annotateLogs({
						running_count: swept.running.length,
						queued_count: swept.queued.length,
						running_ids: swept.running.map(r => r.id),
						queued_ids: swept.queued.map(r => r.id),
					}),
				)
			}

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
			const fiberSem = yield* PartitionedSemaphore.make<string>({
				permits: maxConcurrentFibersTotal,
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
					yield* eventSink
						.fire(`research.${type.replace('run.', '')}`, {
							researchId,
							...(typeof data === 'object' && data !== null ? data : { data }),
						})
						.pipe(Effect.catch(() => Effect.void))
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
					// Rollup parent status based on children (inside same lock)
					yield* sql`
						UPDATE research_runs
						SET status = CASE
							WHEN (SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))
								FROM research_runs WHERE parent_id = ${parentId} AND status != 'deleted') > 0
							THEN 'running'
							WHEN (SELECT COUNT(*) FILTER (WHERE status = 'failed')
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
				}).pipe(sql.withTransaction)

			// ── Core: run a single research fiber ──

			const runFiber = (
				researchId: string,
				userId: string,
				// Reserved for the full budget/quota wiring (not yet plumbed
				// into the LLM tool loop — will feed makeBudgetLayer).
				_policy: ResolvedPolicy,
				_systemCeiling: number,
			) =>
				Effect.gen(function* () {
					// Update status to running
					yield* sql`
						UPDATE research_runs
						SET status = 'running', started_at = now(), updated_at = now()
						WHERE id = ${researchId}
					`

					yield* publishEvent(researchId, 'run.started', {})

					// Load the run row
					const [run] = yield* sql`
						SELECT * FROM research_runs WHERE id = ${researchId}
					`
					if (!run) return

					const context = run['context'] as CreateResearchInput['context']
					const schemaName =
						(run as { schemaName: string | null }).schemaName ?? 'freeform'

					// ── Checkpoint state from any prior partial run ──
					// `phase` + `research_text` + `findings` are persisted after each
					// phase; on resume we skip already-completed phases.
					const checkpointPhase = ((run as { phase?: number | null }).phase ??
						0) as number
					const cachedResearchText = (run as { research_text?: string | null })
						.research_text
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

					// Resolve the schema
					const outputSchema = schemaRegistry[schemaName]
					if (!outputSchema) {
						yield* sql`
							UPDATE research_runs
							SET status = 'failed',
								findings = ${JSON.stringify({ error: `Unknown schema: ${schemaName}` })},
								completed_at = now(), updated_at = now()
							WHERE id = ${researchId}
						`
						yield* publishEvent(researchId, 'run.failed', {
							error: `Unknown schema: ${schemaName}`,
						})
						return
					}

					// Tool log accumulator
					const toolLog = yield* Ref.make<ToolLogEntry[]>([])

					// Build system prompt
					const subjectContext =
						subjects.length > 0
							? `\n\nSubject data (frozen snapshot):\n${JSON.stringify(subjects, null, 2)}`
							: ''
					const hintsContext = context?.hints
						? `\n\nHints: language=${context.hints.language ?? 'en'}, recency=${context.hints.recency_days ?? 'any'}, location=${context.hints.location ?? 'any'}`
						: ''
					const systemPrompt = [
						'You are a research agent for Forja CRM.',
						'Given a query, produce a thorough research brief with findings, sources, and citations.',
						'Never fabricate sources. Every claim must be verifiable.',
						`Output schema: ${schemaName}`,
						subjectContext,
						hintsContext,
					].join('\n')

					// Prior-run token tally carried across resumes
					const priorTokensIn =
						(run as { tokensIn?: number | null }).tokensIn ?? 0
					const priorTokensOut =
						(run as { tokensOut?: number | null }).tokensOut ?? 0

					// ── Phase 1: LLM research pass ──
					// Skipped on resume if the checkpoint captured research_text.
					let researchText: string
					let tokensIn = priorTokensIn
					let tokensOut = priorTokensOut
					if (checkpointPhase >= 1 && cachedResearchText) {
						researchText = cachedResearchText
						yield* Effect.logInfo('research.phase1.resume').pipe(
							Effect.annotateLogs({
								research_id: researchId,
								text_length: researchText.length,
							}),
						)
					} else {
						yield* publishEvent(researchId, 'tool.called', {
							tool: 'llm.generateText',
							phase: 1,
						})
						const researchResponse = yield* agentLlm.generateText({
							prompt: `${systemPrompt}\n\n${(run as { query: string }).query}`,
							toolkit,
							toolChoice: 'auto',
						})
						researchText = researchResponse.text
						tokensIn += researchResponse.usage.inputTokens.total ?? 0
						tokensOut += researchResponse.usage.outputTokens.total ?? 0
						yield* Ref.update(toolLog, log => [
							...log,
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'call' as const,
								tool: 'llm.generateText',
								input: {
									phase: 1,
									query: (run as { query: string }).query,
								},
							},
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'result' as const,
								tool: 'llm.generateText',
								output: { textLength: researchText.length },
							},
						])
						yield* publishEvent(researchId, 'tool.result', {
							tool: 'llm.generateText',
							phase: 1,
							textLength: researchText.length,
						})
						yield* sql`
							UPDATE research_runs
							SET phase = 1,
								research_text = ${researchText},
								tokens_in = ${tokensIn},
								tokens_out = ${tokensOut},
								updated_at = now()
							WHERE id = ${researchId}
						`
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
						yield* publishEvent(researchId, 'tool.called', {
							tool: 'llm.generateObject',
							phase: 2,
							schema: schemaName,
						})
						// Cast schema to satisfy generateObject's Encoder constraint.
						// Registry schemas are all Structs with DecodingServices=never,
						// but Schema.Top erases that — the cast is safe.
						const structuredResponse = yield* extractLlm.generateObject({
							schema: outputSchema as typeof FreeformSchema,
							prompt: `Based on this research, produce structured findings:\n\n${researchText}`,
						})
						findings = structuredResponse.value as unknown
						tokensOut += structuredResponse.usage.outputTokens.total ?? 0
						yield* Ref.update(toolLog, log => [
							...log,
							{
								timestamp: DateTime.nowUnsafe().toString(),
								type: 'result' as const,
								tool: 'llm.generateObject',
								output: { schema: schemaName },
							},
						])
						yield* publishEvent(researchId, 'tool.result', {
							tool: 'llm.generateObject',
							phase: 2,
							schema: schemaName,
						})
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
					yield* publishEvent(researchId, 'tool.called', {
						tool: 'llm.generateText',
						phase: 3,
						language: briefLang,
					})

					const briefResponse = yield* writerLlm.generateText({
						prompt: `Write a concise human-readable research brief in ${briefLang} based on these findings:\n\n${JSON.stringify(findings)}`,
					})

					const briefMd = briefResponse.text
					tokensOut += briefResponse.usage.outputTokens.total ?? 0

					yield* Ref.update(toolLog, log => [
						...log,
						{
							timestamp: DateTime.nowUnsafe().toString(),
							type: 'result' as const,
							tool: 'llm.generateText',
							output: { phase: 3, briefLength: briefMd.length },
						},
					])

					// ── Persist results ──
					const finalToolLog = yield* Ref.get(toolLog)

					yield* sql`
						UPDATE research_runs
						SET status = 'succeeded',
							phase = 3,
							findings = ${JSON.stringify(findings)},
							brief_md = ${briefMd},
							tokens_in = ${tokensIn},
							tokens_out = ${tokensOut},
							tool_log = ${JSON.stringify(finalToolLog)},
							completed_at = now(),
							updated_at = now()
						WHERE id = ${researchId}
					`

					// ── Write to research_cache so identical requests can skip the fiber ──
					const cacheKey = computeResearchCacheKey({
						userId,
						query: (run as { query: string }).query,
						schemaName,
						schemaVersion: schemaVersionFor(schemaName),
						subjects: context?.subjects,
						hints: context?.hints,
					})
					const ttlDays = researchCacheTtlDaysFor(schemaName)
					yield* sql`
						INSERT INTO research_cache (
							key_hash, user_id, research_id, cached_at, expires_at
						) VALUES (
							${cacheKey}, ${userId}, ${researchId},
							now(), now() + (${`${ttlDays} days`})::interval
						)
						ON CONFLICT (key_hash) DO UPDATE SET
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
					Effect.catch((error: unknown) =>
						Effect.gen(function* () {
							yield* sql`
								UPDATE research_runs
								SET status = 'failed',
									findings = ${JSON.stringify({ error: String(error) })},
									completed_at = now(),
									updated_at = now()
								WHERE id = ${researchId}
							`
							yield* publishEvent(researchId, 'run.failed', {
								error: String(error),
							})
						}),
					),
					Effect.ensuring(
						Effect.gen(function* () {
							// Without this shutdown, Stream.fromPubSub keeps the
							// subscriber channel open past the terminal event — the
							// stream only ends when the HTTP socket drops. Shut
							// down before removing the map entry so the interrupt
							// signal reaches waiting subscribers.
							const pubsubMap = yield* Ref.get(activePubSubs)
							const maybePubSub = HashMap.get(pubsubMap, researchId)
							if (maybePubSub._tag === 'Some') {
								yield* PubSub.shutdown(maybePubSub.value)
							}
							yield* Ref.update(activePubSubs, m =>
								HashMap.remove(m, researchId),
							)
							yield* Ref.update(activeFibers, m =>
								HashMap.remove(m, researchId),
							)
						}),
					),
					Effect.annotateLogs({
						research_id: researchId,
						user_id: userId,
						event: 'research.fiber',
					}),
				)

			return {
				/** Create a research run, fork the fiber, return the run id. */
				create: (
					userId: string,
					input: CreateResearchInput,
					systemDefaults: SystemDefaults,
				) =>
					Effect.gen(function* () {
						yield* Effect.logInfo('research.create').pipe(
							Effect.annotateLogs({
								user_id: userId,
								query_length: input.query.length,
								schema: input.schemaName ?? 'freeform',
								mode: input.mode ?? 'deep',
								has_subjects: !!input.context?.subjects?.length,
								has_selector: !!input.context?.selector,
							}),
						)

						// ── Outer research-run cache check ──
						// Identical (user, query, schema, subjects, hints) within TTL
						// returns immediately without forking a fiber. `forceFresh`
						// overrides this and always executes.
						const schemaNameForKey = input.schemaName ?? 'freeform'
						const cacheKey = computeResearchCacheKey({
							userId,
							query: input.query,
							schemaName: schemaNameForKey,
							schemaVersion: schemaVersionFor(schemaNameForKey),
							subjects: input.context?.subjects,
							hints: input.context?.hints,
						})
						if (!input.forceFresh) {
							const hits = yield* sql<{ research_id: string }>`
								SELECT research_id
								FROM research_cache
								WHERE key_hash = ${cacheKey}
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
											query, mode, schema_name, kind, status, context,
											findings, brief_md,
											tokens_in, tokens_out,
											cost_cents, paid_cost_cents,
											idempotency_key, created_by,
											started_at, completed_at
										) VALUES (
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
											now(), now()
										) RETURNING id
									`
									const cloned = clonedRows[0]
									if (!cloned)
										return { id: cachedId, status: 'succeeded' as const }
									const clonedId = cloned.id
									// Clone source attributions from the cached run
									yield* sql`
										INSERT INTO research_run_sources (research_id, source_id, local_ref, fetched_at, cost_cents)
										SELECT ${clonedId}, source_id, local_ref, fetched_at, 0
										FROM research_run_sources
										WHERE research_id = ${cachedId}
										ON CONFLICT DO NOTHING
									`
									if (input.context?.subjects) {
										for (const s of input.context.subjects) {
											yield* sql`
												INSERT INTO research_links (research_id, subject_table, subject_id, link_kind)
												VALUES (${clonedId}, ${s.table}, ${s.id}, 'input')
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

						// Insert the run row
						const [row] = yield* sql`
							INSERT INTO research_runs (
								query, mode, schema_name, status, context,
								budget_cents, paid_budget_cents,
								paid_policy, idempotency_key, created_by
							) VALUES (
								${input.query},
								${input.mode ?? 'deep'},
								${input.schemaName ?? null},
								'queued',
								${JSON.stringify(input.context ?? {})},
								${policy.budgetCents},
								${policy.paidBudgetCents},
								${JSON.stringify(policy)},
								${input.idempotencyKey ?? null},
								${userId}
							) RETURNING id
						`
						const researchId = (row as { id: string }).id

						// Link input subjects
						if (input.context?.subjects) {
							for (const s of input.context.subjects) {
								yield* sql`
									INSERT INTO research_links (research_id, subject_table, subject_id, link_kind)
									VALUES (${researchId}, ${s.table}, ${s.id}, 'input')
									ON CONFLICT DO NOTHING
								`
							}
						}

						// Create PubSub for SSE streaming
						const pubsub = yield* PubSub.unbounded<ResearchEvent>()
						yield* Ref.update(activePubSubs, m =>
							HashMap.set(m, researchId, pubsub),
						)

						// withPermit is wrapped inside the fork, not around it, so
						// create() returns immediately and the permit wait plus its
						// interrupt handler live on the forked fiber. Cancellation
						// while queued then releases the slot cleanly without
						// touching the caller's flow.
						const fiber = yield* Effect.forkDetach(
							fiberSem.withPermit(userId)(
								runFiber(
									researchId,
									userId,
									policy,
									systemDefaults.hardCeiling,
								),
							),
						)
						yield* Ref.update(activeFibers, m =>
							HashMap.set(m, researchId, fiber),
						)

						return { id: researchId, status: 'queued' as const }
					}),

				/** Get a research run by id. Groups include children inline. */
				get: (researchId: string) =>
					Effect.gen(function* () {
						const [run] = yield* sql`
							SELECT r.*,
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

						return yield* sql`
							SELECT r.id, r.kind, r.query, r.mode, r.schema_name,
								r.status, r.cost_cents, r.paid_cost_cents,
								r.created_by, r.created_at, r.completed_at
							FROM research_runs r
							WHERE ${sql.and(conditions)}
							ORDER BY r.created_at DESC
							LIMIT ${filters.limit ?? 20}
							OFFSET ${filters.offset ?? 0}
						`
					}),

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
						yield* sql`
							UPDATE research_runs
							SET status = 'cancelled', completed_at = now(), updated_at = now()
							WHERE id = ${researchId} AND status IN ('queued', 'running')
						`
						yield* publishEvent(researchId, 'run.cancelled', {})
					}),

				/** Soft-delete a research run. */
				softDelete: (researchId: string) =>
					sql`
						UPDATE research_runs
						SET status = 'deleted', updated_at = now()
						WHERE id = ${researchId}
					`,

				/** Post-hoc attach a subject to a run. */
				attach: (researchId: string, subjectTable: string, subjectId: string) =>
					sql`
						INSERT INTO research_links (research_id, subject_table, subject_id, link_kind)
						VALUES (${researchId}, ${subjectTable}, ${subjectId}, 'finding')
						ON CONFLICT DO NOTHING
					`,

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
					},
				) =>
					sql`
						INSERT INTO user_research_policy (user_id, budget_cents, paid_budget_cents, auto_approve_paid_cents, paid_monthly_cap_cents, updated_at)
						VALUES (
							${userId},
							${fields.budgetCents ?? 100},
							${fields.paidBudgetCents ?? 500},
							${fields.autoApprovePaidCents ?? 200},
							${fields.paidMonthlyCapCents ?? 2000},
							now()
						)
						ON CONFLICT (user_id) DO UPDATE SET
							budget_cents = COALESCE(${fields.budgetCents ?? null}, user_research_policy.budget_cents),
							paid_budget_cents = COALESCE(${fields.paidBudgetCents ?? null}, user_research_policy.paid_budget_cents),
							auto_approve_paid_cents = COALESCE(${fields.autoApprovePaidCents ?? null}, user_research_policy.auto_approve_paid_cents),
							paid_monthly_cap_cents = COALESCE(${fields.paidMonthlyCapCents ?? null}, user_research_policy.paid_monthly_cap_cents),
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
