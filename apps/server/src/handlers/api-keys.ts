import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, CurrentOrg, SessionContext } from '@batuda/controllers'

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
						return yield* apiKeyService.list(org.id)
					}),
				)
				.handle('get', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						return yield* apiKeyService.get(org.id, _.params.id)
					}),
				)
				.handle('delete', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						yield* apiKeyService.delete(org.id, _.params.id)
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
