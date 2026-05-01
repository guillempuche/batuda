import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import {
	admin,
	bearer,
	magicLink,
	openAPI,
	organization,
} from 'better-auth/plugins'
import { Effect, Layer, Redacted, ServiceMap } from 'effect'
import pg from 'pg'

import { buildBetterAuthConfig } from '@batuda/auth'

import { TransactionalEmailProvider } from '../services/transactional-email-provider'
import { TransactionalEmailProviderLive } from '../services/transactional-email-provider-live'
import { EnvVars } from './env'

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
								password: string
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
				},
				pool,
				plugins: [
					openAPI(),
					bearer(),
					admin(),
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
							// frontend can't serve. Use the first trusted origin
							// (the public-facing app URL) as the prefix.
							const frontendOrigin = env.ALLOWED_ORIGINS[0]
							if (!frontendOrigin) {
								throw new Error(
									'No ALLOWED_ORIGINS configured; cannot build invitation callbackURL.',
								)
							}
							const callbackURL = `${frontendOrigin.replace(/\/$/, '')}/accept-invitation/${data.id}`

							if (!authHandle) {
								throw new Error(
									'Better Auth is not yet initialized; refusing to send invitation.',
								)
							}
							// Pre-create the invitee — magic-link's verify endpoint
							// refuses to create users when `disableSignUp: true` is
							// set (per
							// docs/repos/better-auth/.../magic-link/index.ts:399-418),
							// so the admin createUser path is the only escape hatch
							// that gives the magic link something to sign in to.
							// `auth.api.createUser` throws USER_ALREADY_EXISTS_USE_
							// ANOTHER_EMAIL if the row exists; treat that as success
							// (existing user being invited to a second org is the
							// happy path).
							try {
								await authHandle.api.createUser({
									body: {
										email: data.email,
										name: data.email.split('@')[0] ?? data.email,
										password: `invite-${data.id}-${Date.now()}-pending`,
									},
									headers: request?.headers ?? new Headers(),
								})
							} catch (cause) {
								const msg = cause instanceof Error ? cause.message : ''
								if (!msg.toLowerCase().includes('already exists')) {
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
					apiKey({ enableSessionForAPIKeys: true }),
					magicLink({
						sendMagicLink: data => {
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
								return Effect.runPromise(
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
							}
							return Effect.runPromise(
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

		return { instance } as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(EnvVars.layer),
		Layer.provide(TransactionalEmailProviderLive),
	)
}
