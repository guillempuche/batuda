import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg, SessionContext } from '@batuda/controllers'

import type { RedactedApiKey } from '../services/api-keys'
import { ApiKeyService } from '../services/api-keys'

const SECONDS_PER_DAY = 86_400

// Org-owned API key management. Full CRUD for any member of the active org
// (OrgMiddleware resolves it and 403s when none is set). Every op runs through
// ApiKeyService, which uses Better Auth's owner pool — so the request's
// app_user scope from OrgMiddleware never touches the `apikey` table.
export const ApiKeysLive = HttpApiBuilder.group(
	BatudaApi,
	'apiKeys',
	handlers =>
		Effect.gen(function* () {
			const apiKeyService = yield* ApiKeyService
			const sql = yield* SqlClient.SqlClient

			// Which tool last used each key. Read here rather than inside
			// ApiKeyService because that service runs on Better Auth's owner pool,
			// and this table is readable only by the ordinary request role — an
			// owner-pool read would come back empty without erroring.
			const withClient = (keys: ReadonlyArray<RedactedApiKey>) =>
				Effect.gen(function* () {
					if (keys.length === 0) return []
					const seen = yield* sql<{
						principalId: string
						clientName: string | null
						clientVersion: string | null
					}>`
						SELECT principal_id, client_name, client_version
						FROM mcp_client_seen
						WHERE principal_kind = 'api_key'
							AND principal_id IN ${sql.in(keys.map(k => k.id))}
					`.pipe(Effect.orDie)
					const byId = new Map(seen.map(row => [row.principalId, row]))
					return keys.map(key => {
						const row = byId.get(key.id)
						return {
							...key,
							client: row
								? { name: row.clientName, version: row.clientVersion }
								: null,
						}
					})
				})

			return handlers
				.handle('create', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						const created = yield* apiKeyService.create(org.id, userId, {
							name: _.payload.name,
							expiresIn:
								_.payload.expiresInDays !== undefined
									? _.payload.expiresInDays * SECONDS_PER_DAY
									: undefined,
						})
						// Audit without the secret — `key` is never logged.
						yield* Effect.logInfo('API key created').pipe(
							Effect.annotateLogs({
								event: 'apikey.created',
								orgId: org.id,
								actorUserId: userId,
								keyId: created.id,
								name: created.name,
							}),
						)
						return created
					}),
				)
				.handle('list', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const keys = yield* apiKeyService.list(org.id)
						return yield* withClient(keys)
					}),
				)
				.handle('get', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const key = yield* apiKeyService.get(org.id, _.params.id)
						const [keyWithClient] = yield* withClient([key])
						return keyWithClient ?? { ...key, client: null }
					}),
				)
				.handle('delete', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						yield* apiKeyService.delete(org.id, _.params.id)
						// Drop the note of which tool used this key: with the key gone
						// nothing ever reads that row again, and nothing else would
						// clear it.
						yield* sql`
							DELETE FROM mcp_client_seen
							WHERE principal_kind = 'api_key' AND principal_id = ${_.params.id}
						`.pipe(Effect.orDie)
						yield* Effect.logInfo('API key deleted').pipe(
							Effect.annotateLogs({
								event: 'apikey.deleted',
								orgId: org.id,
								actorUserId: userId,
								keyId: _.params.id,
							}),
						)
					}),
				)
		}),
)
