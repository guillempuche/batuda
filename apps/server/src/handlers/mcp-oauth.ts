import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, SessionContext } from '@batuda/controllers'

import { McpOAuthService } from '../services/mcp-oauth'

// Org binding for the caller's OAuth MCP connections. Session-auth'd (any
// signed-in user); McpOAuthService validates membership and writes through
// Better Auth's owner pool, so no request-scoped app_user touches the table.
export const McpOAuthLive = HttpApiBuilder.group(
	BatudaApi,
	'mcpOAuth',
	handlers =>
		Effect.gen(function* () {
			const service = yield* McpOAuthService
			return handlers
				.handle('selectOrg', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						yield* service.selectOrg(
							userId,
							_.payload.clientId,
							_.payload.organizationId,
						)
					}),
				)
				.handle('listConnections', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* service.listConnections(userId)
					}),
				)
		}),
)
