import { Config, Effect, Layer, Schedule, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { StorageProvider } from './storage-provider'

/**
 * Prunes research storage that would otherwise grow without bound. Three
 * sweeps, all safe to repeat:
 *
 *  - expired cache rows (search / llm / research / extraction) — their TTL only
 *    gates reads today, nothing ever deletes them;
 *  - the bulky transcript (research_text + tool_log) of runs older than the
 *    retention window, while keeping the run row, its sources, and the citation
 *    trail so a contact's "sourced from research" provenance survives;
 *  - scrape blobs whose source no surviving run fetches and no applied contact
 *    cites — the blob and its global source row are removed together.
 */
export class ResearchRetention extends ServiceMap.Service<ResearchRetention>()(
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
					// Extraction rows carry no expiry of their own, so treat anything
					// older than a week as stale.
					yield* sql`
						DELETE FROM extraction_cache
						WHERE cached_at < now() - interval '7 days'
					`.pipe(Effect.ignore)

					// Drop the bulky transcript of old runs. The run row, its sources,
					// and research_links.citations are left intact so provenance holds.
					yield* sql`
						UPDATE research_runs
						SET research_text = NULL, tool_log = '[]'::jsonb
						WHERE completed_at < now() - interval '1 day' * ${retentionDays}
							AND (research_text IS NOT NULL OR tool_log <> '[]'::jsonb)
					`.pipe(Effect.ignore)

					// Reference-counted blob GC. A scrape blob is orphaned only when no
					// run's sources reference it AND no applied contact cites it; the
					// age gate avoids racing a source just inserted before its links
					// are written.
					const orphans = yield* sql<{
						id: string
						contentRef: string
					}>`
						SELECT s.id, s.content_ref
						FROM sources s
						WHERE s.content_ref IS NOT NULL
							AND s.last_fetched_at < now() - interval '1 day' * ${retentionDays}
							AND NOT EXISTS (
								SELECT 1 FROM research_run_sources rrs
								WHERE rrs.source_id = s.id
							)
							AND NOT EXISTS (
								SELECT 1
								FROM research_links rl,
									LATERAL jsonb_array_elements(
										CASE WHEN jsonb_typeof(rl.citations) = 'array'
											THEN rl.citations ELSE '[]'::jsonb END
									) c
								WHERE c->>'source_id' = s.id
							)
						LIMIT 500
					`.pipe(Effect.orElseSucceed(() => []))

					for (const orphan of orphans) {
						yield* storage.delete(orphan.contentRef).pipe(Effect.ignore)
					}
					if (orphans.length > 0) {
						yield* sql`
							DELETE FROM sources WHERE id IN ${sql.in(orphans.map(o => o.id))}
						`.pipe(Effect.ignore)
					}

					return { orphanBlobs: orphans.length }
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
