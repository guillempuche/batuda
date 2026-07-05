import { createHmac, timingSafeEqual } from 'node:crypto'

import {
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Redacted,
	Schema,
	ServiceMap,
} from 'effect'

import { EnvVars } from '../lib/env'

// Native mailbox OAuth (XOAUTH2) for Google + Microsoft: builds the consent
// URL, exchanges the authorization code for tokens, and refreshes the access
// token. The per-connection tokens live encrypted in `channel_connections`;
// this service only talks to the identity providers' token endpoints.

export type OauthProvider = 'gmail-oauth' | 'm365-oauth'

export class OauthError extends Schema.TaggedErrorClass<OauthError>()(
	'OauthError',
	{
		provider: Schema.String,
		reason: Schema.String,
	},
) {}

export interface OauthTokens {
	readonly accessToken: string
	readonly refreshToken: string
	// Absolute access-token expiry, stored so the worker/probe can refresh
	// proactively before a long-lived IMAP IDLE outlives the ~1h token.
	readonly expiresAt: Date
	// The connected mailbox's own address, read from the id_token.
	readonly email: string
}

interface ProviderEndpoints {
	readonly authUrl: string
	readonly tokenUrl: string
	readonly scopes: readonly string[]
}

const ENDPOINTS: Record<OauthProvider, ProviderEndpoints> = {
	'gmail-oauth': {
		authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenUrl: 'https://oauth2.googleapis.com/token',
		// Full-mailbox scope so IMAP + SMTP both authenticate via XOAUTH2;
		// openid + email make the token response carry an id_token we read the
		// connected address from (the mail scope alone can't call userinfo).
		scopes: ['https://mail.google.com/', 'openid', 'email'],
	},
	'm365-oauth': {
		authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
		tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
		scopes: [
			'https://outlook.office.com/IMAP.AccessAsUser.All',
			'https://outlook.office.com/SMTP.Send',
			'offline_access',
			// openid + email carry the address in the id_token; the Outlook-
			// audience access token cannot call Microsoft Graph /me.
			'openid',
			'email',
		],
	},
}

interface TokenResponse {
	readonly access_token?: string
	readonly refresh_token?: string
	readonly expires_in?: number
	readonly id_token?: string
}

// The OIDC id_token (present because the flow requests openid+email) is a JWT
// the provider just handed us over TLS, so we read its email claim directly
// without re-verifying the signature. Falls back to preferred_username (M365).
const emailFromIdToken = (idToken: string | undefined): string | null => {
	const body = idToken?.split('.')[1]
	if (!body) return null
	try {
		const payload = JSON.parse(
			Buffer.from(body, 'base64url').toString('utf8'),
		) as { email?: unknown; preferred_username?: unknown }
		const email = payload.email ?? payload.preferred_username
		return typeof email === 'string' && email.length > 0 ? email : null
	} catch {
		return null
	}
}

export class OauthTokenService extends ServiceMap.Service<OauthTokenService>()(
	'OauthTokenService',
	{
		make: Effect.gen(function* () {
			const env = yield* EnvVars

			// HMAC key for the OAuth `state` param — reuses the app's auth
			// secret so no new secret needs provisioning.
			const stateSecret = Redacted.value(env.BETTER_AUTH_SECRET)
			const nowMs = () => DateTime.toDateUtc(DateTime.nowUnsafe()).getTime()

			const clientCreds = (provider: OauthProvider) => {
				const id =
					provider === 'gmail-oauth'
						? env.GOOGLE_OAUTH_CLIENT_ID
						: env.MICROSOFT_OAUTH_CLIENT_ID
				const secret =
					provider === 'gmail-oauth'
						? env.GOOGLE_OAUTH_CLIENT_SECRET
						: env.MICROSOFT_OAUTH_CLIENT_SECRET
				if (Option.isNone(id) || Option.isNone(secret)) return null
				return {
					clientId: id.value,
					clientSecret: Redacted.value(secret.value),
				}
			}

			// The consent redirect lands back on the API host; it must match the
			// URI registered with Google / Azure exactly.
			const redirectUri = (provider: OauthProvider) =>
				`${env.BETTER_AUTH_BASE_URL}/v1/email/oauth/${provider}/callback`

			const expiryFrom = (expiresIn: number | undefined): Date =>
				DateTime.toDateUtc(
					DateTime.addDuration(
						DateTime.nowUnsafe(),
						Duration.seconds(expiresIn ?? 3600),
					),
				)

			const postToken = (
				provider: OauthProvider,
				form: Record<string, string>,
			): Effect.Effect<TokenResponse, OauthError> =>
				Effect.gen(function* () {
					const creds = clientCreds(provider)
					if (!creds) {
						return yield* new OauthError({
							provider,
							reason: 'OAuth client credentials are not configured',
						})
					}
					const response = yield* Effect.tryPromise({
						try: () =>
							fetch(ENDPOINTS[provider].tokenUrl, {
								method: 'POST',
								headers: {
									'content-type': 'application/x-www-form-urlencoded',
								},
								body: new URLSearchParams({
									client_id: creds.clientId,
									client_secret: creds.clientSecret,
									...form,
								}).toString(),
							}),
						catch: cause =>
							new OauthError({
								provider,
								reason: `token request failed: ${String(cause)}`,
							}),
					})
					if (!response.ok) {
						const detail = yield* Effect.promise(() => response.text())
						return yield* new OauthError({
							provider,
							reason: `token endpoint ${response.status}: ${detail.slice(0, 300)}`,
						})
					}
					return yield* Effect.tryPromise({
						try: () => response.json() as Promise<TokenResponse>,
						catch: cause =>
							new OauthError({
								provider,
								reason: `malformed token response: ${String(cause)}`,
							}),
					})
				})

			return {
				// Build the provider consent URL. `state` must be a signed value the
				// callback verifies before trusting the org it carries.
				authorizationUrl: (input: {
					provider: OauthProvider
					state: string
				}): string | null => {
					const creds = clientCreds(input.provider)
					// Not configured (client id/secret env unset): return null so the
					// caller sends a clean "OAuth not configured" response instead of
					// bouncing the user to the provider with an empty client_id.
					if (!creds) return null
					const endpoints = ENDPOINTS[input.provider]
					const params = new URLSearchParams({
						client_id: creds.clientId,
						redirect_uri: redirectUri(input.provider),
						response_type: 'code',
						access_type: 'offline',
						prompt: 'consent',
						scope: endpoints.scopes.join(' '),
						state: input.state,
					})
					return `${endpoints.authUrl}?${params.toString()}`
				},

				exchangeCode: (input: {
					provider: OauthProvider
					code: string
				}): Effect.Effect<OauthTokens, OauthError> =>
					Effect.gen(function* () {
						const json = yield* postToken(input.provider, {
							grant_type: 'authorization_code',
							code: input.code,
							redirect_uri: redirectUri(input.provider),
						})
						if (!json.access_token || !json.refresh_token) {
							return yield* new OauthError({
								provider: input.provider,
								reason: 'token response missing access or refresh token',
							})
						}
						const email = emailFromIdToken(json.id_token)
						if (!email) {
							return yield* new OauthError({
								provider: input.provider,
								reason: 'token response id_token missing an email claim',
							})
						}
						return {
							accessToken: json.access_token,
							refreshToken: json.refresh_token,
							expiresAt: expiryFrom(json.expires_in),
							email,
						}
					}),

				refresh: (input: {
					provider: OauthProvider
					refreshToken: string
				}): Effect.Effect<
					{ readonly accessToken: string; readonly expiresAt: Date },
					OauthError
				> =>
					Effect.gen(function* () {
						const json = yield* postToken(input.provider, {
							grant_type: 'refresh_token',
							refresh_token: input.refreshToken,
						})
						if (!json.access_token) {
							return yield* new OauthError({
								provider: input.provider,
								reason: 'refresh response missing access token',
							})
						}
						return {
							accessToken: json.access_token,
							expiresAt: expiryFrom(json.expires_in),
						}
					}),

				// Sign the org+user the consent flow is for into the `state` param.
				// The callback is a public endpoint, so it must not trust any org a
				// client sends — only what this signature vouches for.
				signState: (input: { orgId: string; userId: string }): string => {
					const payload = {
						orgId: input.orgId,
						userId: input.userId,
						// Short TTL — the consent round-trip takes seconds; a stale
						// state must not stay usable minutes later.
						exp: nowMs() + 600_000,
					}
					const body = Buffer.from(JSON.stringify(payload)).toString(
						'base64url',
					)
					const sig = createHmac('sha256', stateSecret)
						.update(`email-oauth-state.${body}`)
						.digest('base64url')
					return `${body}.${sig}`
				},

				// Verify a `state` produced by signState. Returns null on any
				// tamper, malformed input, or expiry — the caller treats null as
				// "reject the callback".
				verifyState: (
					state: string,
				): { readonly orgId: string; readonly userId: string } | null => {
					const dot = state.indexOf('.')
					if (dot <= 0) return null
					const body = state.slice(0, dot)
					const sig = state.slice(dot + 1)
					const expected = createHmac('sha256', stateSecret)
						.update(`email-oauth-state.${body}`)
						.digest('base64url')
					const sigBuf = Buffer.from(sig)
					const expBuf = Buffer.from(expected)
					if (
						sigBuf.length !== expBuf.length ||
						!timingSafeEqual(sigBuf, expBuf)
					) {
						return null
					}
					let payload: {
						orgId?: unknown
						userId?: unknown
						exp?: unknown
					}
					try {
						payload = JSON.parse(
							Buffer.from(body, 'base64url').toString('utf8'),
						)
					} catch {
						return null
					}
					if (
						typeof payload.orgId !== 'string' ||
						typeof payload.userId !== 'string' ||
						typeof payload.exp !== 'number' ||
						payload.exp < nowMs()
					) {
						return null
					}
					return { orgId: payload.orgId, userId: payload.userId }
				},

				// Read the connected mailbox's own address so the row's external_id
				// matches the account the user actually consented with.
				fetchEmailAddress: (input: {
					provider: OauthProvider
					accessToken: string
				}): Effect.Effect<string, OauthError> =>
					Effect.gen(function* () {
						const url =
							input.provider === 'gmail-oauth'
								? 'https://www.googleapis.com/oauth2/v2/userinfo'
								: 'https://graph.microsoft.com/v1.0/me'
						const response = yield* Effect.tryPromise({
							try: () =>
								fetch(url, {
									headers: {
										authorization: `Bearer ${input.accessToken}`,
									},
								}),
							catch: cause =>
								new OauthError({
									provider: input.provider,
									reason: `userinfo request failed: ${String(cause)}`,
								}),
						})
						if (!response.ok) {
							return yield* new OauthError({
								provider: input.provider,
								reason: `userinfo endpoint ${response.status}`,
							})
						}
						const json = yield* Effect.tryPromise({
							try: () => response.json() as Promise<Record<string, unknown>>,
							catch: cause =>
								new OauthError({
									provider: input.provider,
									reason: `malformed userinfo: ${String(cause)}`,
								}),
						})
						const email =
							input.provider === 'gmail-oauth'
								? json['email']
								: (json['mail'] ?? json['userPrincipalName'])
						if (typeof email !== 'string' || email.length === 0) {
							return yield* new OauthError({
								provider: input.provider,
								reason: 'userinfo response has no email address',
							})
						}
						return email
					}),
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
