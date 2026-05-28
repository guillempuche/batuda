import { apiKey } from '@better-auth/api-key'
import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import {
	admin,
	bearer,
	jwt,
	magicLink,
	openAPI,
	organization,
} from 'better-auth/plugins'
import { adminAc, defaultAc } from 'better-auth/plugins/admin/access'
import { Effect, Layer, Redacted, ServiceMap } from 'effect'
import pg from 'pg'

import { buildBetterAuthConfig } from '@batuda/auth'

import { oauthClientGc } from '../plugins/oauth-client-gc'
import { setPasswordRoute } from '../plugins/set-password-route'
import { TransactionalEmailProvider } from '../services/transactional-email-provider'
import { TransactionalEmailProviderLive } from '../services/transactional-email-provider-live'
import { buildInvitationCallbackURL, EnvVars } from './env'

export class Auth extends ServiceMap.Service<Auth>()('Auth', {
	make: Effect.gen(function* () {
		const env = yield* EnvVars
		const transactional = yield* TransactionalEmailProvider

		const pool = new pg.Pool({
			connectionString: Redacted.value(env.DATABASE_URL),
		})

		// The shared builder is the single source of truth for Batuda's
		// Better-Auth config. CLI commands use the same builder with a
		// narrower plugin list (no magicLink) so that API keys and sessions
		// created out-of-band validate against the running server here.
		// Sign-up is invite-only: `emailAndPassword.disableSignUp` closes the
		// public `/auth/sign-up/email` endpoint. New users are created via
		// `auth.api.createUser` (admin plugin escape hatch) — see
		// `pnpm cli auth bootstrap` for the production path.
		//
		// Forward declaration so the org plugin's `sendInvitationEmail`
		// callback can call back into auth.api (createUser + signInMagicLink)
		// without a circular initialization. The callback only fires at
		// request time, by which point the assignment below has happened.
		// Typed against the BA endpoints we actually use — the full inferred
		// `instance.api` type can't be referenced before `instance` exists.
		let authHandle:
			| {
					readonly api: {
						readonly createUser: (req: {
							body: {
								email: string
								name: string
								// Optional: omitting leaves the invitee passwordless.
								password?: string
							}
							headers?: Headers
						}) => Promise<unknown>
						readonly signInMagicLink: (req: {
							body: {
								email: string
								callbackURL?: string
								metadata?: Record<string, unknown>
							}
							headers?: Headers
						}) => Promise<unknown>
					}
			  }
			| undefined

		const instance = betterAuth(
			buildBetterAuthConfig({
				env: {
					secret: Redacted.value(env.BETTER_AUTH_SECRET),
					baseURL: env.BETTER_AUTH_BASE_URL,
					useSecureCookies: !env.BETTER_AUTH_INSECURE_COOKIES,
					trustedOrigins: env.ALLOWED_ORIGINS,
					rateLimit: env.BETTER_AUTH_RATE_LIMIT,
				},
				pool,
				sendResetPassword: async data => {
					// Mirror BA's default `resetPasswordTokenExpiresIn` (1h) and
					// pass it through so the template can tell the recipient
					// whether the link is still good.
					const RESET_TOKEN_TTL_MS = 60 * 60 * 1000
					const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
					await Effect.runPromise(
						transactional.sendResetPassword({
							email: data.user.email,
							url: data.url,
							expiresAt,
						}),
					)
				},
				plugins: [
					openAPI(),
					bearer(),
					// `app_service` is the Batuda role for cross-org
					// superadmins (no membership rows; admin endpoints
					// recognise the role). It mirrors the default `admin`
					// permissions for now — narrowing the surface (e.g.
					// read-only admin endpoints, no impersonate) is a
					// follow-up. `admin` must stay listed because seed
					// users + invitations create it explicitly.
					admin({
						adminRoles: ['admin', 'app_service'],
						roles: {
							admin: adminAc,
							user: defaultAc.newRole({ user: [], session: [] }),
							app_service: adminAc,
						},
					}),
					// Multi-tenant scoping. Every Batuda user belongs to one or more
					// orgs; `session.activeOrganizationId` drives which org a request
					// reads/writes. Tables that own org-scoped data carry an
					// `organization_id` column populated from `CurrentOrg`.
					// `member.primary_inbox_id` is the member's default From identity
					// in this org; the column + FK + ON DELETE SET NULL are added by
					// the migration since `additionalFields` does not generate FKs.
					organization({
						schema: {
							member: {
								additionalFields: {
									primaryInboxId: {
										type: 'string' as const,
										required: false,
										fieldName: 'primary_inbox_id' as const,
									},
								},
							},
						},
						sendInvitationEmail: async (data, request) => {
							// callbackURL must be absolute and point at the
							// frontend host: BA resolves a relative URL against
							// `baseURL` (the API host), and the magic-link verify
							// endpoint then redirects to that resolved URL — so a
							// `/accept-invitation/...` relative path would land on
							// `https://api.batuda.localhost/...` which the
							// frontend can't serve. APP_PUBLIC_URL is the canonical
							// app origin, validated ∈ ALLOWED_ORIGINS at boot.
							const callbackURL = buildInvitationCallbackURL(
								env.APP_PUBLIC_URL,
								data.id,
							)

							if (!authHandle) {
								throw new Error(
									'Better Auth is not yet initialized; refusing to send invitation.',
								)
							}
							// Pre-create the invitee because magic-link verify refuses
							// to create users while `disableSignUp` is on. Omitting
							// `password` keeps invitees passwordless — admin createUser
							// only writes a credential row when one is provided.
							// Second-org invitations fall through the catch arm:
							// `USER_ALREADY_EXISTS` is non-fatal here.
							try {
								await authHandle.api.createUser({
									body: {
										email: data.email,
										name: data.email.split('@')[0] ?? data.email,
									},
									headers: request?.headers ?? new Headers(),
								})
							} catch (cause) {
								// Match by code, not message — locale shifts would
								// silently break a substring predicate.
								const code = (cause as { body?: { code?: string } })?.body?.code
								if (
									code !== 'USER_ALREADY_EXISTS' &&
									code !== 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
								) {
									throw cause
								}
							}
							// Mint a magic-link sign-in URL. The URL is delivered
							// to *our* sendMagicLink callback below; we route it to
							// transactional.sendInvitation (rather than the magic-
							// link template) when metadata.kind === 'invitation'.
							await authHandle.api.signInMagicLink({
								body: {
									email: data.email,
									callbackURL,
									metadata: {
										kind: 'invitation',
										invitationId: data.id,
										inviterName:
											data.inviter.user.name ?? data.inviter.user.email,
										organizationName: data.organization.name,
										expiresAt: data.invitation.expiresAt.toISOString(),
									},
								},
								// signInMagicLink declares `requireHeaders: true`;
								// passing the inbound request's headers (or an empty
								// Headers when called outside a request context) is
								// the documented way to satisfy the gate from
								// inside a server-internal handler.
								headers: request?.headers ?? new Headers(),
							})
						},
					}),
					// enableMetadata: org-owned keys carry { organizationId } so the
					// MCP path resolves the org from the key (BADREQUEST otherwise).
					apiKey({ enableSessionForAPIKeys: true, enableMetadata: true }),
					// OAuth 2.1 Authorization Server for web chat MCP clients
					// (ChatGPT, Claude.ai) that can't send the `x-api-key` header.
					// `oauthProvider` issues JWT access tokens whose `aud` is the
					// requested RFC 8707 resource; `validAudiences` allow-lists the
					// `/mcp` resource so the resource server can verify a token was
					// minted for it. Without it, a `resource=<host>/mcp` request is
					// rejected and tokens fall back to opaque (unverifiable as a JWT).
					// Serves authorize/token/register (open DCR — clients self-register)
					// under /auth; discovery is re-served at the host root by main.ts;
					// the /mcp Bearer branch verifies tokens with `verifyAccessToken`.
					// `jwt()` is required — oauthProvider signs the tokens through it
					// and exposes the JWKS the resource server verifies against.
					// Pin the JWT issuer to the bare origin (not the default
					// baseURL+basePath `…/auth`): the access-token `iss`, the AS
					// metadata `issuer`, the resource server's verify issuer, and the
					// protected-resource `authorization_servers` then all agree on the
					// origin, and discovery is served at the host root (RFC 8414).
					jwt({ jwt: { issuer: env.BETTER_AUTH_BASE_URL } }),
					oauthProvider({
						loginPage: `${env.APP_PUBLIC_URL}/login`,
						consentPage: `${env.APP_PUBLIC_URL}/oauth/consent`,
						requirePKCE: true,
						allowDynamicClientRegistration: true,
						// Short in prod, long in dev (see env). Keeps a leaked or
						// post-offboarding token usable only briefly.
						accessTokenExpiresIn: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
						// Only `/mcp` is allow-listed — it's the sole resource server, so
						// a token for any other audience has no verifier and shouldn't mint.
						validAudiences: [`${env.BETTER_AUTH_BASE_URL}/mcp`],
					}),
					setPasswordRoute(),
					// Garbage-collects abandoned open-DCR clients after each
					// registration (see env OAUTH_CLIENT_GC_DAYS).
					oauthClientGc(pool, env.OAUTH_CLIENT_GC_DAYS),
					magicLink({
						// Closes the silent-signup hole on /sign-in/magic-link.
						// The invitation flow and CLI invite commands pre-create
						// users so verify always has a row to sign in to.
						disableSignUp: true,
						sendMagicLink: async (data, ctx) => {
							// Silently no-op for unknown emails so /sign-in/magic-link
							// can't be used to spam strangers or enumerate membership.
							// Invitations pre-create the invitee, so this is a no-op
							// for that path.
							if (ctx?.context.internalAdapter) {
								const found = await ctx.context.internalAdapter.findUserByEmail(
									data.email,
								)
								if (!found?.user) {
									return
								}
							}
							// Branch on metadata.kind so a magic-link minted from
							// inside `sendInvitationEmail` ships the invitation
							// template instead of the generic sign-in template.
							const meta = data.metadata as
								| {
										kind?: string
										inviterName?: string
										organizationName?: string
										expiresAt?: string
								  }
								| undefined
							if (meta?.kind === 'invitation') {
								await Effect.runPromise(
									transactional.sendInvitation({
										email: data.email,
										inviterName: meta.inviterName ?? 'A teammate',
										organizationName:
											meta.organizationName ?? 'your organization',
										inviteUrl: data.url,
										expiresAt: meta.expiresAt
											? new Date(meta.expiresAt)
											: new Date(Date.now() + 1000 * 60 * 60 * 48),
									}),
								)
								return
							}
							await Effect.runPromise(
								transactional.sendMagicLink({
									email: data.email,
									url: data.url,
									token: data.token,
								}),
							)
						},
					}),
				],
			}),
		)
		authHandle = instance as unknown as typeof authHandle

		// `pool` connects as the DB owner (never SET ROLE app_user), so it is
		// the only path that can read/write the `apikey` table — app_user has
		// no grants on it (migrations/0005). API-key management uses it.
		return { instance, pool } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnvVars.layer),
		Layer.provide(TransactionalEmailProviderLive),
	)
}
