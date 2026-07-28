import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, CurrentOrg, SessionContext } from '@batuda/controllers'

import { McpOAuthService } from '../services/mcp-oauth'

// Org binding for the caller's OAuth MCP connections. Session-auth'd (any
// signed-in user) and McpOAuthService validates membership on every write.
// Choosing orgs writes through Better Auth's owner pool; revoking writes on
// the request connection instead, so the database can check it against the
// organization the request is already acting in.
export const McpOAuthLive = HttpApiBuilder.group(
	BatudaApi,
	'mcpOAuth',
	handlers =>
		Effect.gen(function* () {
			const service = yield* McpOAuthService
			return handlers
				.handle('selectOrgs', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						yield* service.selectOrgs(
							userId,
							_.payload.clientId,
							_.payload.organizationIds,
						)
					}),
				)
				.handle('listConnections', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* service.listConnections(userId)
					}),
				)
				.handle('listOrgConnections', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						return yield* service.listOrgConnections(org.id, userId)
					}),
				)
				.handle('revokeConnection', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						// Omitting `userId` means "my own connection"; the org always
						// comes from the session's active organization, never the body.
						const targetUserId = _.payload.userId ?? userId
						yield* service.revokeConnection(
							org.id,
							userId,
							targetUserId,
							_.payload.clientId,
						)
						yield* Effect.logInfo('MCP connection revoked').pipe(
							Effect.annotateLogs({
								event: 'mcp.connection.revoked',
								orgId: org.id,
								actorUserId: userId,
								targetUserId,
								clientId: _.payload.clientId,
							}),
						)
					}),
				)
				.handle('restoreConnection', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						yield* service.restoreConnection(
							org.id,
							userId,
							_.payload.userId,
							_.payload.clientId,
						)
						// The removal is deleted outright, so this log is the only record
						// that it was ever lifted.
						yield* Effect.logInfo('MCP connection restored').pipe(
							Effect.annotateLogs({
								event: 'mcp.connection.restored',
								orgId: org.id,
								actorUserId: userId,
								targetUserId: _.payload.userId,
								clientId: _.payload.clientId,
							}),
						)
					}),
				)
		}),
)
