import { NodeHttpServerRequest } from '@effect/platform-node'
import { fromNodeHeaders } from 'better-auth/node'
import { verifyAccessToken } from 'better-auth/oauth2'
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
import { EnvVars } from '../lib/env'
import { enterOrgScope } from '../middleware/org'
import { CurrentUser } from './current-user'
import { McpToolsLive } from './server'

const jsonRpcError = (status: number, code: number, message: string) =>
	HttpServerResponse.json(
		{ jsonrpc: '2.0', id: null, error: { code, message } },
		{ status },
	)

// 401 that advertises the OAuth Authorization Server per RFC 9728: keeps the
// JSON-RPC error body the MCP transport expects and points clients at the
// protected-resource metadata. `Access-Control-Expose-Headers` lets a browser
// client read the challenge cross-origin.
const bearerChallenge = (
	code: number,
	message: string,
	resourceMetadataUrl: string,
) =>
	HttpServerResponse.json(
		{ jsonrpc: '2.0', id: null, error: { code, message } },
		{
			status: 401,
			headers: {
				'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
				'Access-Control-Expose-Headers': 'WWW-Authenticate',
			},
		},
	)

const McpAuthMiddleware = HttpRouter.middleware(
	Effect.gen(function* () {
		const { instance } = yield* Auth
		const sql = yield* SqlClient.SqlClient
		const env = yield* EnvVars
		// Where the WWW-Authenticate challenge points clients for discovery.
		const prmUrl = `${env.BETTER_AUTH_BASE_URL}/.well-known/oauth-protected-resource/mcp`

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

				// ── OAuth Bearer path (web chat clients: ChatGPT, Claude.ai). A
				// JWT access token minted by oauthProvider, audience-bound to the
				// /mcp resource. `verifyAccessToken` checks signature (JWKS),
				// audience, issuer, and expiry. The org is resolved from the token's
				// user + client (an explicit per-client selection, else auto-pick for
				// a single-org user). A Bearer token that is not an OAuth JWT (e.g. a
				// Better-Auth session bearer) verifies to `undefined` and falls
				// through to the cookie path below; a Bearer JWT that fails
				// verification is a broken OAuth attempt → challenge.
				const authorization = headers.get('authorization')
				if (authorization?.startsWith('Bearer ')) {
					const token = authorization.slice('Bearer '.length)
					// A thrown verification (bad signature/audience/issuer or expired)
					// → broken OAuth attempt → challenge. A resolved `undefined` (not
					// a JWT, e.g. a session bearer) → fall through to the cookie path.
					const outcome = yield* Effect.tryPromise(() =>
						verifyAccessToken(token, {
							jwksUrl: `${env.BETTER_AUTH_BASE_URL}/auth/jwks`,
							verifyOptions: {
								audience: `${env.BETTER_AUTH_BASE_URL}/mcp`,
								issuer: env.BETTER_AUTH_BASE_URL,
							},
						}),
					).pipe(
						Effect.match({
							onFailure: () => ({ ok: false as const, payload: undefined }),
							onSuccess: payload => ({ ok: true as const, payload }),
						}),
					)
					if (!outcome.ok) {
						return yield* bearerChallenge(
							-32001,
							'Invalid or expired access token',
							prmUrl,
						)
					}
					const payload = outcome.payload
					if (payload) {
						const userId = typeof payload.sub === 'string' ? payload.sub : ''
						const clientId =
							typeof payload['client_id'] === 'string'
								? payload['client_id']
								: ''
						const userRows = yield* sql<{
							id: string
							email: string
							name: string | null
						}>`
							SELECT id, email, name FROM "user" WHERE id = ${userId} LIMIT 1
						`.pipe(Effect.orDie)
						const user = userRows[0]
						if (!user) {
							return yield* bearerChallenge(
								-32003,
								'Token user is no longer available',
								prmUrl,
							)
						}
						// Every current membership — the owner role bypasses member RLS
						// before scope, so this sees all of the user's orgs.
						const memberships = yield* sql<{ organizationId: string }>`
							SELECT "organizationId" FROM member WHERE "userId" = ${userId}
						`.pipe(Effect.orDie)
						const orgIds = memberships.map(m => m.organizationId)
						if (orgIds.length === 0) {
							return yield* jsonRpcError(
								403,
								-32002,
								'Token user is not a member of any organization',
							)
						}
						// An explicit per-client selection wins, but only while it is
						// still a live membership: a stale row (user left the org) falls
						// back to auto-pick so the token can't read an org the user no
						// longer belongs to.
						const selection = yield* sql<{ organizationId: string }>`
							SELECT organization_id FROM mcp_oauth_org
							WHERE user_id = ${userId} AND client_id = ${clientId} LIMIT 1
						`.pipe(Effect.orDie)
						const selectedOrgId = selection[0]?.organizationId
						const orgId =
							selectedOrgId && orgIds.includes(selectedOrgId)
								? selectedOrgId
								: orgIds.length === 1
									? orgIds[0]
									: undefined
						if (!orgId) {
							return yield* jsonRpcError(
								403,
								-32002,
								'Select an organization for this connection at /settings/mcp/connections',
							)
						}
						const org = yield* loadOrg(orgId)
						if (!org) {
							return yield* jsonRpcError(
								403,
								-32003,
								`Organization ${orgId} not found`,
							)
						}
						return yield* enterScope(org, {
							userId: user.id,
							email: user.email,
							name: user.name,
							isAgent: false,
						})
					}
					// payload undefined → opaque/session bearer → fall through.
				}

				// ── Cookie-session path (human/web).
				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)
				if (!result) {
					return yield* bearerChallenge(-32001, 'Unauthorized', prmUrl)
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
