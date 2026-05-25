import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { Effect, Layer } from 'effect'
import { McpServer } from 'effect/unstable/ai'
import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'

import { SessionContext } from '@batuda/controllers'

import { Auth } from '../lib/auth'
import { enterOrgScope } from '../middleware/org'
import { CurrentUser } from './current-user'
import { McpToolsLive } from './server'

const McpAuthMiddleware = HttpRouter.middleware(
	Effect.gen(function* () {
		const { instance } = yield* Auth
		const sql = yield* SqlClient.SqlClient

		return httpEffect =>
			Effect.gen(function* () {
				const req = yield* HttpServerRequest.HttpServerRequest
				if (!req.url.startsWith('/mcp')) {
					return yield* httpEffect
				}

				const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
				const headers = fromNodeHeaders(incomingMessage.headers)
				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)

				if (!result) {
					return yield* HttpServerResponse.json(
						{
							jsonrpc: '2.0',
							id: null,
							error: { code: -32001, message: 'Unauthorized' },
						},
						{ status: 401 },
					)
				}

				// `activeOrganizationId` is contributed by the Better-Auth
				// `organization` plugin via `additionalFields`; it is not part of
				// the base `Session` type, so we widen the read site instead of
				// re-augmenting Better-Auth's exported types.
				const activeOrgId = (
					result.session as { activeOrganizationId?: string | null }
				).activeOrganizationId
				if (!activeOrgId) {
					return yield* HttpServerResponse.json(
						{
							jsonrpc: '2.0',
							id: null,
							error: {
								code: -32002,
								message:
									'No active organization on session — call /auth/organization/set-active first',
							},
						},
						{ status: 403 },
					)
				}

				// Org lookup faults die as a defect, mirroring the HTTP path —
				// an infra failure here isn't a JSON-RPC protocol error.
				const orgRows = yield* sql<{
					id: string
					name: string
					slug: string
				}>`
					SELECT id, name, slug
					FROM "organization"
					WHERE id = ${activeOrgId}
					LIMIT 1
				`.pipe(Effect.orDie)
				const org = orgRows[0]
				if (!org) {
					return yield* HttpServerResponse.json(
						{
							jsonrpc: '2.0',
							id: null,
							error: {
								code: -32003,
								message: `Active organization ${activeOrgId} not found`,
							},
						},
						{ status: 403 },
					)
				}

				// Enter the org scope via the shared combinator (role + both
				// GUCs + CurrentOrg in one tx, faults die) so the MCP tool sees
				// the same RLS-scoped reads as the HTTP path. CurrentUser and
				// SessionContext are MCP-only, provided on top.
				return yield* httpEffect.pipe(
					Effect.provideService(CurrentUser, {
						userId: result.user.id,
						email: result.user.email,
						name: result.user.name ?? 'Unknown',
						isAgent: result.user.isAgent === true,
					}),
					// SessionContext mirrors CurrentUser using the controllers-
					// package tag so service-layer code that consumes SessionContext
					// (e.g. EmailService) works identically across HTTP and MCP.
					Effect.provideService(SessionContext, {
						userId: result.user.id,
						email: result.user.email,
						name: result.user.name ?? undefined,
						isAgent: result.user.isAgent === true,
					}),
					enterOrgScope(sql, { org, userId: result.user.id }),
				)
			})
	}),
	{ global: true },
)

export const McpHttpLive = Layer.mergeAll(McpToolsLive, McpAuthMiddleware).pipe(
	Layer.provide(
		McpServer.layerHttp({ name: 'batuda', version: '1.0.0', path: '/mcp' }),
	),
)
