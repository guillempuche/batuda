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

const jsonRpcError = (status: number, code: number, message: string) =>
	HttpServerResponse.json(
		{ jsonrpc: '2.0', id: null, error: { code, message } },
		{ status },
	)

const McpAuthMiddleware = HttpRouter.middleware(
	Effect.gen(function* () {
		const { instance } = yield* Auth
		const sql = yield* SqlClient.SqlClient

		const loadOrg = (orgId: string) =>
			sql<{ id: string; name: string; slug: string }>`
				SELECT id, name, slug FROM "organization" WHERE id = ${orgId} LIMIT 1
			`.pipe(
				Effect.orDie,
				Effect.map(rows => rows[0]),
			)

		return httpEffect =>
			Effect.gen(function* () {
				const req = yield* HttpServerRequest.HttpServerRequest
				if (!req.url.startsWith('/mcp')) {
					return yield* httpEffect
				}

				const incomingMessage = NodeHttpServerRequest.toIncomingMessage(req)
				const headers = fromNodeHeaders(incomingMessage.headers)

				// Shared tail: provide the principal (MCP-only CurrentUser +
				// controllers-package SessionContext, so service-layer code works
				// across transports) and enter the org's app_user scope.
				const enterScope = (
					org: { id: string; name: string; slug: string },
					principal: {
						readonly userId: string
						readonly email: string
						readonly name: string | null
						readonly isAgent: boolean
					},
				) =>
					httpEffect.pipe(
						Effect.provideService(CurrentUser, {
							userId: principal.userId,
							email: principal.email,
							name: principal.name ?? 'Unknown',
							isAgent: principal.isAgent,
						}),
						Effect.provideService(SessionContext, {
							userId: principal.userId,
							email: principal.email,
							name: principal.name ?? undefined,
							isAgent: principal.isAgent,
						}),
						enterOrgScope(sql, { org, userId: principal.userId }),
					)

				// ── API-key path (AI/MCP clients): the key resolves to its org's
				// agent user (referenceId) and the org from metadata — no cookie
				// session or activeOrganizationId is involved. Fail closed.
				const apiKey = headers.get('x-api-key')
				if (apiKey) {
					const verified = yield* Effect.promise(() =>
						instance.api.verifyApiKey({ body: { key: apiKey } }),
					)
					// verifyApiKey returns valid:false for unknown/disabled/expired/
					// rate-limited keys (it never throws for those).
					if (!verified.valid || !verified.key) {
						return yield* jsonRpcError(401, -32001, 'Invalid API key')
					}
					const orgId = (
						verified.key.metadata as { organizationId?: string } | null
					)?.organizationId
					if (!orgId) {
						return yield* jsonRpcError(401, -32001, 'API key is not org-scoped')
					}
					const org = yield* loadOrg(orgId)
					const agentRows = yield* sql<{
						id: string
						email: string
						name: string | null
					}>`
						SELECT id, email, name FROM "user"
						WHERE id = ${verified.key.referenceId} LIMIT 1
					`.pipe(Effect.orDie)
					const agent = agentRows[0]
					// Org or agent user deleted out from under the key → fail closed.
					if (!org || !agent) {
						return yield* jsonRpcError(
							403,
							-32003,
							'API key organization or agent is no longer available',
						)
					}
					return yield* enterScope(org, {
						userId: agent.id,
						email: agent.email,
						name: agent.name,
						isAgent: true,
					})
				}

				// ── Cookie-session path (human/web).
				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)
				if (!result) {
					return yield* jsonRpcError(401, -32001, 'Unauthorized')
				}

				// `activeOrganizationId` is contributed by the Better-Auth
				// `organization` plugin via `additionalFields`; it is not part of
				// the base `Session` type, so we widen the read site instead of
				// re-augmenting Better-Auth's exported types.
				const activeOrgId = (
					result.session as { activeOrganizationId?: string | null }
				).activeOrganizationId
				if (!activeOrgId) {
					return yield* jsonRpcError(
						403,
						-32002,
						'No active organization on session — call /auth/organization/set-active first',
					)
				}
				const org = yield* loadOrg(activeOrgId)
				if (!org) {
					return yield* jsonRpcError(
						403,
						-32003,
						`Active organization ${activeOrgId} not found`,
					)
				}
				return yield* enterScope(org, {
					userId: result.user.id,
					email: result.user.email,
					name: result.user.name ?? null,
					isAgent: result.user.isAgent === true,
				})
			})
	}),
	{ global: true },
)

export const McpHttpLive = Layer.mergeAll(McpToolsLive, McpAuthMiddleware).pipe(
	Layer.provide(
		McpServer.layerHttp({ name: 'batuda', version: '1.0.0', path: '/mcp' }),
	),
)
