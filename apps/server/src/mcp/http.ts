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
import { enterOrgScope, enterUserScope } from '../middleware/org'
import { clientIdentityOf, recordClientSeen } from './client-seen'
import { CurrentUser } from './current-user'
import { McpToolsLive } from './server'

const jsonRpcError = (
	status: number,
	code: number,
	message: string,
	headers?: Record<string, string>,
) =>
	HttpServerResponse.json(
		{ jsonrpc: '2.0', id: null, error: { code, message } },
		{ status, ...(headers ? { headers } : {}) },
	)

// MCP clients (ChatGPT, Claude.ai) surface an auth rejection as a silent retry
// loop, not a visible error — so every 401/403 path logs why it fired. `reason`
// is a fixed enum-like string (never a token or key) so the rejections are
// queryable without leaking a credential.
const rejectAuth = <A, E, R>(
	reason: string,
	response: Effect.Effect<A, E, R>,
) =>
	Effect.logWarning('MCP auth rejected').pipe(
		Effect.annotateLogs({ event: 'mcp.auth.rejected', reason }),
		Effect.andThen(response),
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

// A redeploy starts a fresh process whose in-memory MCP session table is empty,
// so a client keeps sending a session id the new process never minted. McpServer
// answers that unknown `Mcp-Session-Id` with a 404 itself (a compliant client
// then drops the session and re-`initialize`s), so no app-layer recovery is
// needed here — McpServer stays the sole owner of sessions.

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
					authMethod: 'api_key' | 'oauth' | 'cookie',
					org: { id: string; name: string; slug: string },
					principal: {
						readonly userId: string
						readonly email: string
						readonly name: string | null
						readonly isAgent: boolean
						// Which key or connection this is, so the tool using it can be
						// recorded against it. Absent on the browser path, which is a
						// person in a tab rather than a machine connection.
						readonly credentialId?: string | undefined
					},
				) =>
					// Tag the request span with how the caller authenticated and the
					// org it resolved to BEFORE running the tool — the tool-call context
					// needed to debug an MCP "disconnection" (silent 401 loop) from
					// Honeycomb alone, present even if the tool then fails.
					Effect.annotateCurrentSpan({
						'mcp.auth_method': authMethod,
						'mcp.org_id': org.id,
						'mcp.principal_is_agent': principal.isAgent,
					}).pipe(
						Effect.andThen(
							Effect.gen(function* () {
								// Read the body only now, once the credential has checked
								// out, so an unauthenticated caller can never make the
								// server hold a whole request in memory before its 401.
								// Reading it here is safe: the request keeps the body it
								// read, so the handler below sees that same value instead
								// of re-reading a stream already consumed.
								if (
									authMethod !== 'cookie' &&
									principal.credentialId !== undefined
								) {
									const body = yield* req.json.pipe(
										Effect.orElseSucceed(() => null),
									)
									yield* recordClientSeen(sql, {
										orgId: org.id,
										principalKind:
											authMethod === 'api_key' ? 'api_key' : 'oauth',
										principalId: principal.credentialId,
										userId: principal.userId,
										client: clientIdentityOf(body),
										userAgent: headers.get('user-agent'),
									})
								}
								return yield* httpEffect
							}).pipe(
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
							),
						),
					)

				// ── API-key path (AI/MCP clients): the org and the creating member
				// come from the key's metadata; the session acts as that member so
				// actions attribute to them — no cookie or activeOrganizationId
				// involved. Fail closed.
				const apiKey = headers.get('x-api-key')
				if (apiKey) {
					const verified = yield* Effect.promise(() =>
						instance.api.verifyApiKey({ body: { key: apiKey } }),
					)
					if (!verified.valid || !verified.key) {
						// A throttled key comes back with a distinct code (not a bad
						// credential): answer 429 + Retry-After so the client backs off
						// instead of treating it as an invalid credential.
						const error = verified.error as {
							code?: string
							details?: { tryAgainIn?: number }
						} | null
						if (
							error?.code === 'RATE_LIMITED' ||
							error?.code === 'USAGE_EXCEEDED'
						) {
							const tryAgainIn = error.details?.tryAgainIn
							return yield* jsonRpcError(
								429,
								-32001,
								'API key rate limit exceeded',
								typeof tryAgainIn === 'number'
									? { 'retry-after': String(Math.ceil(tryAgainIn / 1000)) }
									: undefined,
							)
						}
						return yield* rejectAuth(
							'invalid_api_key',
							jsonRpcError(401, -32001, 'Invalid API key'),
						)
					}
					const meta = verified.key.metadata as {
						organizationId?: string
						createdByUserId?: string
					} | null
					const orgId = meta?.organizationId
					if (!orgId) {
						return yield* rejectAuth(
							'api_key_not_org_scoped',
							jsonRpcError(401, -32001, 'API key is not org-scoped'),
						)
					}
					// Required, never silently org-attributed: a key with no creator
					// in its metadata is rejected outright.
					const createdByUserId = meta?.createdByUserId
					if (!createdByUserId) {
						return yield* rejectAuth(
							'api_key_no_creator',
							jsonRpcError(403, -32003, 'API key has no creator; recreate it'),
						)
					}
					const org = yield* loadOrg(orgId)
					// Resolve the creator and confirm they are still a live member of the
					// org: the key stops working once they leave.
					const creatorRows = yield* sql<{
						id: string
						email: string
						name: string | null
					}>`
						SELECT u.id, u.email, u.name FROM "user" u
						JOIN member m ON m."userId" = u.id AND m."organizationId" = ${orgId}
						WHERE u.id = ${createdByUserId} LIMIT 1
					`.pipe(Effect.orDie)
					const creator = creatorRows[0]
					if (!org || !creator) {
						return yield* rejectAuth(
							'api_key_creator_not_member',
							jsonRpcError(
								403,
								-32003,
								'API key creator is no longer a member of its organization',
							),
						)
					}
					return yield* enterScope('api_key', org, {
						userId: creator.id,
						email: creator.email,
						name: creator.name,
						isAgent: true,
						credentialId: verified.key.id,
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
								// Pin the signature algorithm. The signing keys are EdDSA;
								// without this pin, adding any other key type to the JWKS
								// later would open the door to algorithm-substitution.
								algorithms: ['EdDSA'],
							},
						}),
					).pipe(
						Effect.match({
							onFailure: () => ({ ok: false as const, payload: undefined }),
							onSuccess: payload => ({ ok: true as const, payload }),
						}),
					)
					if (!outcome.ok) {
						return yield* rejectAuth(
							'invalid_or_expired_token',
							bearerChallenge(
								-32001,
								'Invalid or expired access token',
								prmUrl,
							),
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
							return yield* rejectAuth(
								'token_user_unavailable',
								bearerChallenge(
									-32003,
									'Token user is no longer available',
									prmUrl,
								),
							)
						}
						// Read the caller's memberships (all their orgs) and the
						// per-client orgs they've authorized this connection to act in,
						// under the resolver role: the user GUC's RLS confines both
						// reads to this user even if a WHERE slips. enterUserScope
						// returns plain values and commits before we enter org scope
						// below — it must not nest inside enterScope.
						const { orgIds, selectedOrgIds, revokedOrgIds } =
							yield* enterUserScope(
								sql,
								userId,
							)(
								Effect.gen(function* () {
									const memberships = yield* sql<{ organizationId: string }>`
								SELECT "organizationId" FROM member WHERE "userId" = ${userId}
							`
									const selection = yield* sql<{ organizationId: string }>`
								SELECT organization_id FROM mcp_oauth_org_membership
								WHERE user_id = ${userId} AND client_id = ${clientId}
							`
									// Orgs this connection has been cut off from. Read on every
									// request, which is what makes cutting one off take effect
									// immediately: the access token itself is self-contained
									// and cannot be called back once handed out.
									const revoked = yield* sql<{ organizationId: string }>`
								SELECT organization_id FROM mcp_oauth_revocation
								WHERE user_id = ${userId} AND client_id = ${clientId}
							`
									return {
										orgIds: memberships.map(m => m.organizationId),
										selectedOrgIds: selection.map(s => s.organizationId),
										revokedOrgIds: revoked.map(r => r.organizationId),
									}
								}),
							)
						if (orgIds.length === 0) {
							return yield* rejectAuth(
								'token_user_no_org',
								jsonRpcError(
									403,
									-32002,
									'Token user is not a member of any organization',
								),
							)
						}
						// The orgs this connection is explicitly authorized to act in,
						// narrowed to live memberships: a stale row (user left the org)
						// is dropped so the token can't reach an org the user no longer
						// belongs to. A connection nobody has touched yet falls back to
						// the user's live orgs — single-org users get auto-resolution
						// without ever visiting the connections page. But a connection
						// that HAS a selection where every row is stale is rejected, not
						// widened: the user deliberately scoped this connection, and
						// silently widening it to orgs they never chose would be a
						// privilege escalation.
						//
						// Untouched counts revocations too: a connection cut off from the
						// last org it was allowed in must not read as one nobody has
						// chosen for, or it would be handed every org the person belongs
						// to — the exact opposite of what was asked for.
						const liveSelectedOrgIds = selectedOrgIds.filter(id =>
							orgIds.includes(id),
						)
						const isUntouched =
							selectedOrgIds.length === 0 && revokedOrgIds.length === 0
						const allowedOrgIds = (
							isUntouched ? orgIds : liveSelectedOrgIds
						).filter(id => !revokedOrgIds.includes(id))
						if (allowedOrgIds.length === 0) {
							return yield* rejectAuth(
								'no_authorized_org',
								jsonRpcError(
									403,
									-32002,
									'Select an organization for this connection at /settings/mcp/connections',
								),
							)
						}
						// An explicit per-request hint picks which authorized org this
						// call acts in. A valid hint (within the authorized set) always
						// wins; without a hint, a single authorized org auto-resolves.
						// A hint that points at an org the connection is not authorized
						// for is rejected — the client can't reach an org it never
						// consented to even if the user is still a member of it.
						const hint = headers.get('x-batuda-organization-id')
						const orgId = hint
							? allowedOrgIds.includes(hint)
								? hint
								: undefined
							: allowedOrgIds.length === 1
								? allowedOrgIds[0]
								: undefined
						if (!orgId) {
							// Point at the settings page first: an assistant sets headers
							// once for a whole connection, if at all, so asking someone to
							// send one per call is asking for something most of them cannot
							// do. Narrowing the connection to one organization works
							// everywhere; the header stays as a footnote for the
							// command-line clients that can send it.
							return yield* rejectAuth(
								hint ? 'org_hint_not_authorized' : 'org_selection_required',
								jsonRpcError(
									403,
									-32002,
									hint
										? 'X-Batuda-Organization-Id is not authorized for this connection'
										: 'This connection is authorized for more than one organization. Choose one at /settings/mcp/connections, or send X-Batuda-Organization-Id with one of them.',
								),
							)
						}
						const org = yield* loadOrg(orgId)
						if (!org) {
							return yield* rejectAuth(
								'org_not_found',
								jsonRpcError(403, -32003, `Organization ${orgId} not found`),
							)
						}
						return yield* enterScope('oauth', org, {
							userId: user.id,
							email: user.email,
							name: user.name,
							isAgent: false,
							credentialId: clientId,
						})
						// payload undefined → opaque/session bearer → fall through.
					}
				}

				// ── Cookie-session path (human/web).
				const result = yield* Effect.promise(() =>
					instance.api.getSession({ headers }),
				)
				if (!result) {
					return yield* rejectAuth(
						'no_session',
						bearerChallenge(-32001, 'Unauthorized', prmUrl),
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
					return yield* rejectAuth(
						'no_active_org',
						jsonRpcError(
							403,
							-32002,
							'No active organization on session — call /auth/organization/set-active first',
						),
					)
				}
				const org = yield* loadOrg(activeOrgId)
				if (!org) {
					return yield* rejectAuth(
						'active_org_not_found',
						jsonRpcError(
							403,
							-32003,
							`Active organization ${activeOrgId} not found`,
						),
					)
				}
				return yield* enterScope('cookie', org, {
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
