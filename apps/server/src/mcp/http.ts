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
// so effect's McpServer no longer knows the session id a connected client keeps
// sending and raises "Mcp-Session-Id does not exist". It runs tool calls in the
// background and folds that failure into a normal HTTP 200 body, so the
// client is never told to re-initialize and replays the dead id forever. The MCP
// spec's fix is to answer 404 (a compliant client then drops the session and
// re-`initialize`s), so we detect that failure in McpServer's own reply and swap
// it for a 404 — keeping McpServer the sole owner of sessions. Matching its
// message is the only signal it exposes.
const UNKNOWN_SESSION_DIE_MESSAGE = 'Mcp-Session-Id does not exist'

// Reused across every MCP reply rather than reallocated per request.
const mcpBodyDecoder = new TextDecoder()

// True when a decoded JSON-RPC reply carries McpServer's unknown-session
// failure, not a tool result that merely echoed the same phrase. McpServer
// buries that failure deep in the reply's error cause, shaped like
// `{ error: { data: [{ _tag: 'Die', defect: { message } }] } }` — so we check
// exactly that spot. Handles a single reply or a batched array of them.
const isUnknownSessionErrorBody = (parsed: unknown): boolean => {
	const replies = Array.isArray(parsed) ? parsed : [parsed]
	return replies.some(reply => {
		const failures = (reply as { error?: { data?: unknown } } | null)?.error
			?.data
		return (
			Array.isArray(failures) &&
			failures.some(failure => {
				const die = failure as {
					_tag?: string
					defect?: { message?: string }
				} | null
				return (
					die?._tag === 'Die' &&
					die?.defect?.message === UNKNOWN_SESSION_DIE_MESSAGE
				)
			})
		)
	})
}

// Turn McpServer's unknown-session failure — which it hides inside a normal 200
// reply — into the MCP spec's 404 so the client re-initializes. Any other reply
// passes through untouched. Exported for its unit test.
export const recoverUnknownSession = (
	response: HttpServerResponse.HttpServerResponse,
) => {
	const body = response.body
	// The JSON-RPC transport never streams, so the whole reply body is in hand.
	if (body._tag !== 'Uint8Array') return Effect.succeed(response)
	const text = mcpBodyDecoder.decode(body.body)
	// Cheap gate: only the unknown-session reply contains this phrase, so skip
	// parsing every other MCP reply.
	if (!text.includes(UNKNOWN_SESSION_DIE_MESSAGE))
		return Effect.succeed(response)
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return Effect.succeed(response)
	}
	if (!isUnknownSessionErrorBody(parsed)) return Effect.succeed(response)
	// Mark the request span so Honeycomb can count how often clients replay a
	// session the process forgot (chiefly right after a redeploy). The generic
	// completion log still records the app-layer 200; this is the signal that the
	// reply was swapped to a 404.
	return Effect.annotateCurrentSpan({ 'mcp.session_recovered': true }).pipe(
		Effect.andThen(
			jsonRpcError(404, -32001, 'MCP session expired; reinitialize'),
		),
	)
}

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
								// Recover a client whose session id predates the last redeploy:
								// turn McpServer's hidden failure into a 404 it can act on.
								Effect.flatMap(recoverUnknownSession),
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
						const { orgIds, selectedOrgIds } = yield* enterUserScope(
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
								return {
									orgIds: memberships.map(m => m.organizationId),
									selectedOrgIds: selection.map(s => s.organizationId),
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
						// belongs to. An unbound connection (no selection rows at all)
						// falls back to the user's live orgs — single-org users get
						// auto-resolution without ever visiting the connections page.
						// But a connection that HAS a selection where every row is stale
						// is rejected, not widened: the user deliberately scoped this
						// connection, and silently widening it to orgs they never chose
						// would be a privilege escalation.
						const liveSelectedOrgIds = selectedOrgIds.filter(id =>
							orgIds.includes(id),
						)
						const isUnbound = selectedOrgIds.length === 0
						const allowedOrgIds = isUnbound ? orgIds : liveSelectedOrgIds
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
							return yield* rejectAuth(
								hint ? 'org_hint_not_authorized' : 'org_selection_required',
								jsonRpcError(
									403,
									-32002,
									hint
										? 'X-Batuda-Organization-Id is not authorized for this connection'
										: allowedOrgIds.length === 1
											? 'Select an organization for this connection at /settings/mcp/connections'
											: 'Send X-Batuda-Organization-Id with one of the authorized organizations',
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
