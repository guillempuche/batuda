/**
 * Wraps an `ExtractProvider` with a DB-backed cache (`extraction_cache`).
 *
 * Key = sha256(url + schemaName + schemaVersion + 'default-model'). The
 * extract provider is the one exposed to the tool loop as
 * `extract_structured`; since extraction is deterministic per (content,
 * schema, model), repeated extractions during retries or fan-out reuse
 * prior results.
 *
 * Cache only runs when the caller provides `schemaName`. Inputs that carry
 * an ad-hoc `Schema.Top` without a registry name are treated as non-cacheable
 * (there's no stable identity to key on). In practice everything in the
 * research fiber goes through `schemaRegistry`, so this is a correctness
 * guardrail rather than a common path.
 *
 * The provider is treated as a single logical "model" for caching purposes
 * since we don't currently pass a model selector into `ExtractInput`. When
 * we later wire the LLM-backed `extract_structured` tool (phase 8), the
 * per-call model is part of the key.
 */

import { createHash } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { type ExtractInput, ExtractProvider } from '../application/ports'
import { ProviderError } from '../domain/errors'

const sha256Hex = (input: string): string =>
	createHash('sha256').update(input).digest('hex')

const contentHashForUrl = (url: string): string => sha256Hex(url)

const DEFAULT_MODEL = 'extract-default'

export const makeCachedExtract = () =>
	Layer.effect(
		ExtractProvider,
		Effect.gen(function* () {
			const inner = yield* ExtractProvider
			const sql = yield* SqlClient.SqlClient

			const extract = (input: ExtractInput) =>
				Effect.gen(function* () {
					if (!input.schemaName) {
						return yield* inner.extract(input)
					}

					const contentHash = contentHashForUrl(input.url)
					const version = input.schemaVersion ?? 1
					const keyHash = sha256Hex(
						`${contentHash}|${input.schemaName}|${version}|${DEFAULT_MODEL}`,
					)

					const hits = yield* sql<{ result: unknown }>`
						SELECT result
						FROM extraction_cache
						WHERE key_hash = ${keyHash}
						LIMIT 1
					`
					if (hits[0]) {
						yield* Effect.logDebug('cache.hit').pipe(
							Effect.annotateLogs({
								event: 'cache.hit',
								port: 'extract',
								cache_table: 'extraction_cache',
								key_hash: keyHash,
							}),
						)
						return hits[0].result
					}

					return yield* Effect.gen(function* () {
						yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`extract:${keyHash}`}))`
						const rehits = yield* sql<{ result: unknown }>`
							SELECT result
							FROM extraction_cache
							WHERE key_hash = ${keyHash}
							LIMIT 1
						`
						if (rehits[0]) return rehits[0].result

						const result = yield* inner.extract(input)
						yield* sql`
							INSERT INTO extraction_cache (
								key_hash, content_hash, schema_name, schema_version,
								model, result, cached_at
							) VALUES (
								${keyHash}, ${contentHash}, ${input.schemaName},
								${version}, ${DEFAULT_MODEL},
								${JSON.stringify(result)}::jsonb, now()
							)
							ON CONFLICT (key_hash) DO UPDATE SET
								result    = EXCLUDED.result,
								cached_at = EXCLUDED.cached_at
						`
						return result
					}).pipe(sql.withTransaction)
				}).pipe(
					Effect.catchTag(
						'SqlError',
						(e): Effect.Effect<unknown, ProviderError> =>
							Effect.fail(
								new ProviderError({
									provider: 'cache',
									message: `extraction_cache query failed: ${e.message}`,
									recoverable: true,
								}),
							),
					),
				)

			return ExtractProvider.of({ extract })
		}),
	)
