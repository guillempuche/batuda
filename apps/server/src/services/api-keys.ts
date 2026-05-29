import { Effect, Layer, ServiceMap } from 'effect'

import { NotFound } from '@batuda/controllers'

import { Auth } from '../lib/auth'
import { EnvVars } from '../lib/env'

// Returned once on create — `key` is the plaintext the caller must store now
// (Better Auth hashes it on write, so it is unrecoverable afterward).
export interface CreatedApiKey {
	readonly id: string
	readonly key: string
	readonly name: string | null
	readonly start: string | null
	readonly prefix: string | null
	readonly expiresAt: string | null
	readonly createdAt: string
}

// Resolved creator of a key — the human whose session minted it.
interface Creator {
	readonly id: string
	readonly name: string | null
	readonly email: string
}

// List/get shape — never carries the secret, only the masked `start` prefix.
export interface RedactedApiKey {
	readonly id: string
	readonly name: string | null
	readonly start: string | null
	readonly prefix: string | null
	readonly expiresAt: string | null
	readonly createdAt: string
	readonly enabled: boolean
	readonly createdBy: Creator | null
}

interface KeyRow {
	readonly id: string
	readonly name: string | null
	readonly start: string | null
	readonly prefix: string | null
	readonly expiresAt: string | Date | null
	readonly createdAt: string | Date
	readonly enabled: boolean
	readonly metadata: string | null
}

const isoOrNull = (value: string | Date | null): string | null =>
	value === null ? null : new Date(value).toISOString()

// Better Auth stores key metadata as a JSON string column; pull the creator id
// back out, tolerating a double-encoded value.
const parseCreatorId = (metadata: string | null): string | null => {
	if (!metadata) return null
	try {
		let parsed: unknown = JSON.parse(metadata)
		if (typeof parsed === 'string') parsed = JSON.parse(parsed)
		return (
			(parsed as { createdByUserId?: string } | null)?.createdByUserId ?? null
		)
	} catch {
		return null
	}
}

const toRedacted = (
	row: KeyRow,
	createdBy: Creator | null,
): RedactedApiKey => ({
	id: row.id,
	name: row.name,
	start: row.start,
	prefix: row.prefix,
	expiresAt: isoOrNull(row.expiresAt),
	createdAt: new Date(row.createdAt).toISOString(),
	enabled: row.enabled,
	createdBy,
})

const SELECT_COLS =
	'id, name, start, prefix, "expiresAt", "createdAt", enabled, metadata'

// API keys are owned by a per-org agent user (`isAgent`) and carry the org in
// their Better Auth `metadata`; the MCP transport reads that to scope the
// session. All `apikey`/agent-user access goes through Better Auth's owner
// pool: `app_user` has no grants on the `apikey` table (migrations/0005), and
// the table has no org column to RLS-scope — isolation is enforced here by the
// per-org `referenceId` predicate on every query.
export class ApiKeyService extends ServiceMap.Service<ApiKeyService>()(
	'ApiKeyService',
	{
		make: Effect.gen(function* () {
			const auth = yield* Auth
			const env = yield* EnvVars

			// One deterministic agent user per org. `.internal` is never a routable
			// mailbox; the user is passwordless (no `password` → no account row) and
			// `isAgent`, so it never surfaces in human sign-in/member flows.
			const agentEmail = (orgId: string) =>
				`agent+${orgId}@keys.batuda.internal`

			// Resolve the org's agent user id without creating it — reads (list/get)
			// and delete must not mint a phantom agent for an org that has no keys.
			// Case-insensitive: Better Auth normalizes the stored email to lower
			// case, while org ids (in the local part) are mixed-case.
			const findAgentId = (orgId: string) =>
				Effect.tryPromise(() =>
					auth.pool.query<{ id: string }>(
						'SELECT id FROM "user" WHERE lower(email) = lower($1) LIMIT 1',
						[agentEmail(orgId)],
					),
				).pipe(
					Effect.orDie,
					Effect.map(r => r.rows[0]?.id ?? null),
				)

			const getOrCreateAgentId = (orgId: string) =>
				Effect.gen(function* () {
					const existing = yield* findAgentId(orgId)
					if (existing) return existing
					// Headerless admin createUser: no session/permission gate, and the
					// `data` fields land on the user's additionalFields (isAgent).
					// Ignore the result: a concurrent create (or a prior row) surfaces
					// `USER_ALREADY_EXISTS`, and the re-select below is the source of
					// truth either way — so two racing creates converge on one agent.
					yield* Effect.tryPromise(() =>
						auth.instance.api.createUser({
							body: {
								email: agentEmail(orgId),
								name: `API agent (${orgId})`,
								data: { isAgent: true },
							},
						}),
					).pipe(Effect.ignore)
					const created = yield* findAgentId(orgId)
					if (!created)
						return yield* Effect.die(
							new Error(`agent user missing after create for org ${orgId}`),
						)
					return created
				})

			// Batch-resolve the human creators of a set of keys so a listing can
			// label each key with who minted it — one query, not one per key.
			const resolveCreators = (rows: ReadonlyArray<KeyRow>) =>
				Effect.gen(function* () {
					const ids = [
						...new Set(
							rows
								.map(r => parseCreatorId(r.metadata))
								.filter((id): id is string => id !== null),
						),
					]
					if (ids.length === 0) return new Map<string, Creator>()
					const users = yield* Effect.tryPromise(() =>
						auth.pool.query<Creator>(
							'SELECT id, name, email FROM "user" WHERE id = ANY($1)',
							[ids],
						),
					).pipe(Effect.orDie)
					return new Map(users.rows.map(u => [u.id, u] as const))
				})

			return {
				create: (
					orgId: string,
					actorUserId: string,
					input: {
						readonly name: string
						readonly expiresIn?: number | undefined
					},
				): Effect.Effect<CreatedApiKey> =>
					Effect.gen(function* () {
						const agentId = yield* getOrCreateAgentId(orgId)
						// No `headers`/`request` on purpose: `userId`, `metadata`, and
						// `rateLimitEnabled` are server-only and rejected on a call that
						// looks client-originated.
						const result = yield* Effect.tryPromise(() =>
							auth.instance.api.createApiKey({
								body: {
									userId: agentId,
									name: input.name,
									metadata: {
										organizationId: orgId,
										createdByUserId: actorUserId,
									},
									// Stamp the limit from config rather than inherit Better
									// Auth's 10-req/day default, which a single MCP turn (many
									// tool calls) would blow through.
									rateLimitEnabled: env.API_KEY_RATE_LIMIT_ENABLED,
									...(env.API_KEY_RATE_LIMIT_ENABLED
										? {
												rateLimitMax: env.API_KEY_RATE_LIMIT_MAX,
												rateLimitTimeWindow:
													env.API_KEY_RATE_LIMIT_WINDOW_SECONDS * 1000,
											}
										: {}),
									...(input.expiresIn !== undefined
										? { expiresIn: input.expiresIn }
										: {}),
								},
							}),
						).pipe(Effect.orDie)
						return {
							id: result.id,
							key: result.key,
							name: result.name ?? null,
							start: result.start ?? null,
							prefix: result.prefix ?? null,
							expiresAt: isoOrNull(result.expiresAt ?? null),
							createdAt: new Date(result.createdAt).toISOString(),
						}
					}),

				list: (orgId: string): Effect.Effect<ReadonlyArray<RedactedApiKey>> =>
					Effect.gen(function* () {
						const agentId = yield* findAgentId(orgId)
						if (!agentId) return []
						const rows = yield* Effect.tryPromise(() =>
							auth.pool.query<KeyRow>(
								`SELECT ${SELECT_COLS} FROM apikey
								 WHERE "referenceId" = $1 AND enabled = true
								   AND ("expiresAt" IS NULL OR "expiresAt" > now())
								 ORDER BY "createdAt" DESC`,
								[agentId],
							),
						).pipe(Effect.orDie)
						const creators = yield* resolveCreators(rows.rows)
						return rows.rows.map(row =>
							toRedacted(
								row,
								creators.get(parseCreatorId(row.metadata) ?? '') ?? null,
							),
						)
					}),

				get: (
					orgId: string,
					keyId: string,
				): Effect.Effect<RedactedApiKey, NotFound> =>
					Effect.gen(function* () {
						const agentId = yield* findAgentId(orgId)
						if (!agentId)
							return yield* new NotFound({ entity: 'apiKey', id: keyId })
						const rows = yield* Effect.tryPromise(() =>
							auth.pool.query<KeyRow>(
								`SELECT ${SELECT_COLS} FROM apikey
								 WHERE id = $1 AND "referenceId" = $2 LIMIT 1`,
								[keyId, agentId],
							),
						).pipe(Effect.orDie)
						const row = rows.rows[0]
						if (!row)
							return yield* new NotFound({ entity: 'apiKey', id: keyId })
						const creators = yield* resolveCreators([row])
						return toRedacted(
							row,
							creators.get(parseCreatorId(row.metadata) ?? '') ?? null,
						)
					}),

				delete: (orgId: string, keyId: string): Effect.Effect<void, NotFound> =>
					Effect.gen(function* () {
						const agentId = yield* findAgentId(orgId)
						if (!agentId)
							return yield* new NotFound({ entity: 'apiKey', id: keyId })
						const result = yield* Effect.tryPromise(() =>
							auth.pool.query(
								'DELETE FROM apikey WHERE id = $1 AND "referenceId" = $2',
								[keyId, agentId],
							),
						).pipe(Effect.orDie)
						if (result.rowCount === 0)
							return yield* new NotFound({ entity: 'apiKey', id: keyId })
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
