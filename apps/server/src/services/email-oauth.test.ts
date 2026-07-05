import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'

import { Effect, Exit, Layer, Option, Redacted } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvVars } from '../lib/env.js'
import { OauthTokenService } from './email-oauth.js'

// The OAuth callback is a public endpoint — it trusts only the org + user the
// signed `state` vouches for. These cases pin that trust boundary: a valid
// state round-trips, and any tamper, malformed input, or expiry is rejected.
// The token exchange/refresh (real HTTP to Google/Microsoft) is out of scope
// here; it is covered in test-user mode against the live providers.

const STATE_SECRET = 'test-oauth-state-secret-0123456789'

// Stub EnvVars with only what OauthTokenService reads at build time — the real
// one pulls every env the server boot needs. The state HMAC keys off
// BETTER_AUTH_SECRET; the rest feed authorizationUrl + the token exchange.
const stubEnv = Layer.succeed(EnvVars, {
	BETTER_AUTH_SECRET: Redacted.make(STATE_SECRET),
	BETTER_AUTH_BASE_URL: 'https://api.test.local',
	GOOGLE_OAUTH_CLIENT_ID: Option.some('google-client-id'),
	GOOGLE_OAUTH_CLIENT_SECRET: Option.some(Redacted.make('google-secret')),
	MICROSOFT_OAUTH_CLIENT_ID: Option.some('ms-client-id'),
	MICROSOFT_OAUTH_CLIENT_SECRET: Option.some(Redacted.make('ms-secret')),
} as never)

// A second env with the OAuth client env unset, to exercise the "not
// configured" path where authorizationUrl must decline rather than build a URL
// with an empty client_id.
const stubEnvUnconfigured = Layer.succeed(EnvVars, {
	BETTER_AUTH_SECRET: Redacted.make(STATE_SECRET),
	BETTER_AUTH_BASE_URL: 'https://api.test.local',
	GOOGLE_OAUTH_CLIENT_ID: Option.none(),
	GOOGLE_OAUTH_CLIENT_SECRET: Option.none(),
	MICROSOFT_OAUTH_CLIENT_ID: Option.none(),
	MICROSOFT_OAUTH_CLIENT_SECRET: Option.none(),
} as never)

interface ServiceMethods {
	readonly signState: (input: { orgId: string; userId: string }) => string
	readonly verifyState: (
		state: string,
	) => { readonly orgId: string; readonly userId: string } | null
	readonly authorizationUrl: (input: {
		provider: 'gmail-oauth' | 'm365-oauth'
		state: string
	}) => string | null
}

const withService = <A>(
	use: (svc: ServiceMethods) => A,
	env: Layer.Layer<EnvVars> = stubEnv,
): Promise<A> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const svc = yield* OauthTokenService
			return use(svc)
		}).pipe(Effect.provide(OauthTokenService.layer.pipe(Layer.provide(env)))),
	)

// Sign a state body with the known test secret so a case can forge or expire a
// payload while keeping the HMAC otherwise valid.
const signBody = (payload: object): string => {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
	const sig = createHmac('sha256', STATE_SECRET)
		.update(`email-oauth-state.${body}`)
		.digest('base64url')
	return `${body}.${sig}`
}

// A provider id_token is a JWT; exchangeCode reads only its (unverified)
// payload, so a header.payload.sig shape with a base64url JSON payload suffices.
const craftIdToken = (payload: object): string =>
	`header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

// Stub global fetch with one canned token-endpoint response so exchangeCode
// runs without reaching Google / Microsoft.
const mockTokenEndpoint = (body: unknown, ok = true) => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok,
			status: ok ? 200 : 400,
			json: async () => body,
			text: async () => JSON.stringify(body),
		})),
	)
}

const runExchange = (input: {
	provider: 'gmail-oauth' | 'm365-oauth'
	code: string
}) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const svc = yield* OauthTokenService
			return yield* svc.exchangeCode(input)
		}).pipe(
			Effect.provide(OauthTokenService.layer.pipe(Layer.provide(stubEnv))),
		),
	)

describe('OauthTokenService signed state', () => {
	describe('when a signed state is verified back unchanged', () => {
		it('should recover the original org and user', async () => {
			// GIVEN a state signed for an org + user
			// WHEN it is verified without modification
			// THEN the same org + user come back
			const result = await withService(svc =>
				svc.verifyState(svc.signState({ orgId: 'org-1', userId: 'user-1' })),
			)
			expect(result).toEqual({ orgId: 'org-1', userId: 'user-1' })
		})
	})

	describe('when the signature is tampered', () => {
		it('should reject with null', async () => {
			// GIVEN a valid state whose signature is replaced
			// WHEN verified
			// THEN null — the HMAC no longer matches the body
			const result = await withService(svc => {
				const state = svc.signState({ orgId: 'org-1', userId: 'user-1' })
				const body = state.slice(0, state.indexOf('.'))
				return svc.verifyState(`${body}.tampered-signature`)
			})
			expect(result).toBeNull()
		})
	})

	describe('when the body is swapped for a different org', () => {
		it('should reject with null even though a signature is present', async () => {
			// GIVEN a forged body naming another org, kept next to a real signature
			//   from a legitimately signed state
			// WHEN verified
			// THEN null — the signature covers the body, so the swap is caught
			const result = await withService(svc => {
				const legit = svc.signState({ orgId: 'org-1', userId: 'user-1' })
				const sig = legit.slice(legit.indexOf('.') + 1)
				const forged = Buffer.from(
					JSON.stringify({
						orgId: 'org-evil',
						userId: 'user-1',
						exp: 4102444800000,
					}),
				).toString('base64url')
				return svc.verifyState(`${forged}.${sig}`)
			})
			expect(result).toBeNull()
		})
	})

	describe('when the state is malformed', () => {
		it('should return null for input with no separator', async () => {
			// GIVEN a string with no `.` between body and signature
			// WHEN verified
			// THEN null
			const result = await withService(svc =>
				svc.verifyState('not-a-valid-state'),
			)
			expect(result).toBeNull()
		})

		it('should return null when the body is not valid base64url JSON', async () => {
			// GIVEN a body that decodes to non-JSON but carries a matching signature
			// WHEN verified
			// THEN null — the payload parse fails closed
			const result = await withService(svc => {
				const body = Buffer.from('this is not json').toString('base64url')
				const sig = createHmac('sha256', STATE_SECRET)
					.update(`email-oauth-state.${body}`)
					.digest('base64url')
				return svc.verifyState(`${body}.${sig}`)
			})
			expect(result).toBeNull()
		})
	})

	describe('when a correctly-signed state has expired', () => {
		it('should return null independently of the signature', async () => {
			// GIVEN a properly-signed state whose exp is in the past
			// WHEN verified
			// THEN null — expiry is enforced even though the HMAC is valid
			const expired = signBody({
				orgId: 'org-1',
				userId: 'user-1',
				exp: 1000,
			})
			const result = await withService(svc => svc.verifyState(expired))
			expect(result).toBeNull()
		})
	})
})

describe('OauthTokenService authorization URL', () => {
	describe('when the provider is configured', () => {
		it('should carry the client id, scopes, and state to the provider', async () => {
			// GIVEN a configured provider and a signed state
			// WHEN the authorization URL is built
			// THEN it targets the provider consent endpoint and carries the client
			//   id, the openid + email scopes, and the state verbatim
			const url = await withService(svc =>
				svc.authorizationUrl({
					provider: 'gmail-oauth',
					state: 'signed-state',
				}),
			)
			expect(url).toContain('accounts.google.com')
			expect(url).toContain('client_id=google-client-id')
			expect(url).toContain('state=signed-state')
			expect(url).toContain('openid')
		})
	})

	describe('when the provider is not configured', () => {
		it('should return null instead of a URL with an empty client_id', async () => {
			// GIVEN a provider whose client id + secret env is unset
			// WHEN the authorization URL is built
			// THEN null — the caller sends a clean "not configured" response rather
			//   than bouncing the user to the provider with an empty client_id
			const url = await withService(
				svc =>
					svc.authorizationUrl({ provider: 'gmail-oauth', state: 'signed' }),
				stubEnvUnconfigured,
			)
			expect(url).toBeNull()
		})
	})
})

describe('OauthTokenService exchangeCode', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe('when the token endpoint returns tokens and an id_token', () => {
		it('should return the tokens with the address read from the id_token', async () => {
			// GIVEN a token endpoint returning access + refresh tokens and an
			//   id_token carrying the mailbox address
			// WHEN the authorization code is exchanged
			// THEN the tokens come back with the address parsed from the id_token
			mockTokenEndpoint({
				access_token: 'access-1',
				refresh_token: 'refresh-1',
				expires_in: 3600,
				id_token: craftIdToken({ email: 'mailbox@gmail.com' }),
			})
			const exit = await runExchange({
				provider: 'gmail-oauth',
				code: 'auth-code',
			})
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value.accessToken).toBe('access-1')
				expect(exit.value.refreshToken).toBe('refresh-1')
				expect(exit.value.email).toBe('mailbox@gmail.com')
			}
		})
	})

	describe('when the token response omits a refresh token', () => {
		it('should fail rather than persist a connection that cannot be refreshed', async () => {
			// GIVEN a token endpoint returning an access token but no refresh token
			// WHEN the code is exchanged
			// THEN it fails — without a refresh token the connection dies at expiry
			mockTokenEndpoint({ access_token: 'access-1', expires_in: 3600 })
			const exit = await runExchange({
				provider: 'gmail-oauth',
				code: 'auth-code',
			})
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})

	describe('when the id_token carries no email claim', () => {
		it('should fail rather than store a mailbox with no address', async () => {
			// GIVEN tokens whose id_token has no email or preferred_username claim
			// WHEN the code is exchanged
			// THEN it fails — the row's address must reflect the consented account
			mockTokenEndpoint({
				access_token: 'access-1',
				refresh_token: 'refresh-1',
				id_token: craftIdToken({ sub: 'no-email-here' }),
			})
			const exit = await runExchange({
				provider: 'gmail-oauth',
				code: 'auth-code',
			})
			expect(Exit.isFailure(exit)).toBe(true)
		})
	})
})
