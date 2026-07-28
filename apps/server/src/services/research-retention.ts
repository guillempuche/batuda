import { Config, Context, Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { StorageProvider } from './storage-provider'

/**
 * Clears out what research leaves behind. Four sweeps, all safe to repeat:
 *
 *  - expired cache rows (search / llm / research) — their TTL only
 *    gates reads today, nothing ever deletes them;
 *  - the bulky transcript (research_text + tool_log) of runs older than the
 *    retention window, while keeping the run row, its sources, and the citation
 *    trail so a contact's "sourced from research" provenance survives;
 *  - stored page text nothing points at any more — the stored copy and the
 *    record of the page go together;
 *  - records of pages a run only saw named, which never had a stored copy, once
 *    nothing points at them either.
 *
 * The last two are kept apart deliberately. Pages a run merely saw outnumber the
 * ones it stored by roughly ten to one, so sharing a batch would leave the
 * stored copies queued behind them — and those are the ones that cost money to
 * keep.
 */
export class ResearchRetention extends Context.Service<ResearchRetention>()(
	'ResearchRetention',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const storage = yield* StorageProvider
			const retentionDays = yield* Config.int('RESEARCH_RETENTION_DAYS').pipe(
				Config.withDefault(90),
			)

			const sweepExpired = () =>
				Effect.gen(function* () {
					// Expired caches: the write sets expires_at, but no read path ever
					// deletes a stale row, so they accumulate.
					yield* sql`DELETE FROM search_cache WHERE expires_at < now()`.pipe(
						Effect.ignore,
					)
					yield* sql`DELETE FROM llm_cache WHERE expires_at < now()`.pipe(
						Effect.ignore,
					)
					yield* sql`DELETE FROM research_cache WHERE expires_at < now()`.pipe(
						Effect.ignore,
					)

					// Drop the bulky transcript of old runs. The run row, its sources,
					// and research_links.citations are left intact so provenance holds.
					yield* sql`
						UPDATE research_runs
						SET research_text = NULL, tool_log = '[]'::jsonb
						WHERE completed_at < now() - interval '1 day' * ${retentionDays}
							AND (research_text IS NOT NULL OR tool_log <> '[]'::jsonb)
					`.pipe(Effect.ignore)

					// Nothing points at this page any more. Three ways it could still be
					// spoken for: a run lists it among what it read, a paid lookup was
					// charged against it, or an applied change cites it. A citation
					// names either the stable record id or the page's own address —
					// the model is asked to cite the address it read — so both have to
					// be checked, or a page that is cited looks unwanted.
					const unreferenced = sql`
						NOT EXISTS (
							SELECT 1 FROM research_run_sources rrs
							WHERE rrs.source_id = s.id
						)
						AND NOT EXISTS (
							SELECT 1 FROM research_paid_spend ps
							WHERE ps.source_id = s.id
						)
						AND NOT EXISTS (
							SELECT 1
							FROM research_links rl,
								LATERAL jsonb_array_elements(
									CASE WHEN jsonb_typeof(rl.citations) = 'array'
										THEN rl.citations ELSE '[]'::jsonb END
								) c
							WHERE c->>'source_id' = s.id OR c->>'source_id' = s.url
						)
					`

					// One row that is still spoken for would make the whole batch fail,
					// so say so instead of dropping it silently — a sweep that quietly
					// stops clearing anything looks exactly like one with nothing to do.
					const forgetSources = (ids: ReadonlyArray<string>) =>
						sql`DELETE FROM sources WHERE id IN ${sql.in(ids)}`.pipe(
							Effect.tapError(error =>
								Effect.logWarning('research.retention.forget_failed').pipe(
									Effect.annotateLogs({
										event: 'research.retention.forget_failed',
										rows: ids.length,
										message: error.message,
									}),
								),
							),
							Effect.ignore,
						)

					// The age gate avoids racing a page recorded moments ago, before the
					// run that read it has finished writing what it points at.
					const olderThanWindow = sql`
						s.last_fetched_at < now() - interval '1 day' * ${retentionDays}
					`

					const orphans = yield* sql<{
						id: string
						contentRef: string
					}>`
						SELECT s.id, s.content_ref
						FROM sources s
						WHERE s.content_ref IS NOT NULL
							AND ${olderThanWindow}
							AND ${unreferenced}
						LIMIT 500
					`.pipe(Effect.orElseSucceed(() => []))

					for (const orphan of orphans) {
						yield* storage.delete(orphan.contentRef).pipe(Effect.ignore)
					}
					if (orphans.length > 0) {
						yield* forgetSources(orphans.map(o => o.id))
					}

					// Pages a run only saw named keep no stored copy, so there is
					// nothing to delete but the record itself.
					const seenOnly = yield* sql<{ id: string }>`
						SELECT s.id
						FROM sources s
						WHERE s.content_ref IS NULL
							AND ${olderThanWindow}
							AND ${unreferenced}
						LIMIT 500
					`.pipe(Effect.orElseSucceed(() => []))

					if (seenOnly.length > 0) {
						yield* forgetSources(seenOnly.map(row => row.id))
					}

					return { orphanBlobs: orphans.length, seenOnly: seenOnly.length }
				})

			return { sweepExpired } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)

	// Outputs no service (`effectDiscard`), so it must be listed in `mergeAll`,
	// never `provideMerge`. Default cadence is hourly; the window is measured in
	// days, so a missed tick can't leak anything past its retention.
	static readonly sweepDaemonLayer = Layer.effectDiscard(
		Effect.gen(function* () {
			const retention = yield* ResearchRetention
			const intervalSec = yield* Config.int(
				'RESEARCH_RETENTION_SWEEP_INTERVAL_SEC',
			).pipe(Config.withDefault(3600))
			yield* Effect.logInfo('research retention sweep started').pipe(
				Effect.annotateLogs({ intervalSec }),
			)
			yield* retention.sweepExpired().pipe(
				Effect.tapError(error =>
					Effect.logError('research retention sweep failed', error),
				),
				Effect.ignore,
				Effect.repeat(Schedule.spaced(`${intervalSec} seconds`)),
				Effect.forkScoped,
			)
		}),
	)
}
