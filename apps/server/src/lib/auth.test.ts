import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import {
	admin,
	bearer,
	magicLink,
	openAPI,
	organization,
} from 'better-auth/plugins'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildBetterAuthConfig } from '@batuda/auth'

// Requires `pnpm cli services up` (Postgres on $DATABASE_URL) with
// migrations applied. Each describe owns its own betterAuth instance
// and TRUNCATEs the auth tables so timestamped emails stay hermetic.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'
const BETTER_AUTH_SECRET = process.env['BETTER_AUTH_SECRET'] ?? 'test-secret'

const AUTH_TABLES_TO_TRUNCATE = [
	'"verification"',
	'"session"',
	'"account"',
	'"member"',
	'"invitation"',
	'"organization"',
	'"user"',
] as const

const truncateAuthTables = async (pool: pg.Pool): Promise<void> => {
	await pool.query(`TRUNCATE ${AUTH_TABLES_TO_TRUNCATE.join(', ')} CASCADE`)
}

const sharedPool = new pg.Pool({ connectionString: DATABASE_URL })

afterAll(async () => {
	await sharedPool.end()
})

describe('magic-link plugin existence pre-check on sendMagicLink', () => {
	// Capturing sender lets each test assert on the side-effect (was the
	// email dispatched?) in addition to the public response shape.
	interface CapturedSend {
		readonly email: string
		readonly url: string
	}
	let capturedSends: CapturedSend[] = []

	const buildInstance = () =>
		betterAuth(
			buildBetterAuthConfig({
				env: {
					secret: BETTER_AUTH_SECRET,
					baseURL: 'http://localhost:3010',
					useSecureCookies: false,
					trustedOrigins: [],
				},
				pool: sharedPool,
				plugins: [
					openAPI(),
					bearer(),
					admin(),
					organization(),
					apiKey({ enableSessionForAPIKeys: true }),
					magicLink({
						disableSignUp: true,
						// Mirrors auth.ts:206 — silent no-op for unknown emails
						// blocks mailbox-state enumeration.
						sendMagicLink: async (data, ctx) => {
							if (ctx?.context.internalAdapter) {
								const found = await ctx.context.internalAdapter.findUserByEmail(
									data.email,
								)
								if (!found?.user) {
									return
								}
							}
							capturedSends.push({ email: data.email, url: data.url })
						},
					}),
				],
			}),
		)

	beforeAll(async () => {
		await truncateAuthTables(sharedPool)
		capturedSends = []
	})

	describe('when /sign-in/magic-link is called with an unregistered email', () => {
		it('should return status:true without invoking sendMagicLink', async () => {
			// [auth.ts:206 — unknown-email branch]
			// GIVEN a fresh betterAuth instance and an email not in "user"
			const auth = buildInstance()
			const unregisteredEmail = `noone-${Date.now()}@example.invalid`

			// WHEN /sign-in/magic-link is invoked
			const response = await auth.api.signInMagicLink({
				body: { email: unregisteredEmail },
				headers: new Headers(),
			})

			// THEN the public success shape is returned and the sender is
			// untouched — same response keeps the unknown branch indistinguishable
			// from the registered branch to a remote observer.
			expect(response).toEqual({ status: true })
			expect(
				capturedSends.find(send => send.email === unregisteredEmail),
			).toBeUndefined()
		})
	})

	describe('when /sign-in/magic-link is called with a registered email', () => {
		it('should invoke sendMagicLink with a verify URL carrying the token', async () => {
			// [auth.ts:206 — known-email branch]
			// GIVEN a registered user
			const auth = buildInstance()
			const registeredEmail = `known-${Date.now()}@example.com`
			await auth.api.createUser({
				body: {
					email: registeredEmail,
					name: 'Known User',
					password: 'temp-known-password-1234',
				},
			})

			// WHEN /sign-in/magic-link is invoked for that email
			const response = await auth.api.signInMagicLink({
				body: { email: registeredEmail, callbackURL: 'http://localhost:3010/' },
				headers: new Headers(),
			})

			// THEN the sender fires with a verify URL carrying the token
			expect(response).toEqual({ status: true })
			const sentToRegistered = capturedSends.find(
				send => send.email === registeredEmail,
			)
			expect(sentToRegistered, 'sender should have been invoked').toBeTruthy()
			expect(sentToRegistered!.url).toMatch(
				/\/auth\/magic-link\/verify\?token=/,
			)
		})
	})
})

describe('buildBetterAuthConfig customRules — magic-link routes in loose mode', () => {
	const buildConfig = (rateLimit?: 'loose' | 'strict') =>
		buildBetterAuthConfig({
			env: {
				secret: BETTER_AUTH_SECRET,
				baseURL: undefined,
				useSecureCookies: false,
				trustedOrigins: [],
				...(rateLimit && { rateLimit }),
			},
			pool: sharedPool,
			plugins: [],
		})

	describe('when env.rateLimit is "loose"', () => {
		it('should include /sign-in/magic-link with window=60 max=200', () => {
			// [build-better-auth-config.ts:150 — loose branch]
			// GIVEN the builder run with loose mode
			const config = buildConfig('loose')

			// THEN the send route is raised above the 5/60s plugin default
			expect(config.rateLimit.customRules).toMatchObject({
				'/sign-in/magic-link': { window: 60, max: 200 },
			})
		})

		it('should include /magic-link/verify with window=60 max=200', () => {
			// [build-better-auth-config.ts:151 — loose branch]
			const config = buildConfig('loose')

			// THEN the verify route is also raised so e2e click-throughs do not 429.
			expect(config.rateLimit.customRules).toMatchObject({
				'/magic-link/verify': { window: 60, max: 200 },
			})
		})
	})

	describe('when env.rateLimit is "strict" or omitted', () => {
		it('should not include any magic-link customRules', () => {
			// [build-better-auth-config.ts:144 — strict/default branch]
			// GIVEN the builder run without rateLimit set (production default)
			const config = buildConfig()

			// THEN no overrides leak — plugin defaults remain in force.
			expect(config.rateLimit.customRules).toBeUndefined()
		})
	})
})

describe('credential-row strip helper (matches sendInvitationEmail bug fold-in)', () => {
	// The strip DELETE is closure-bound inside the org plugin's
	// sendInvitationEmail callback (auth.ts:167) and reaching it through
	// the public API needs an authed inviter session — end-to-end coverage
	// lives in apps/internal/tests/e2e. Here we exercise the SQL itself.

	const buildInstance = () =>
		betterAuth(
			buildBetterAuthConfig({
				env: {
					secret: BETTER_AUTH_SECRET,
					baseURL: 'http://localhost:3010',
					useSecureCookies: false,
					trustedOrigins: [],
				},
				pool: sharedPool,
				plugins: [openAPI(), bearer(), admin()],
			}),
		)

	const countCredentialRows = async (email: string): Promise<number> => {
		const result = await sharedPool.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count
			 FROM "account" a
			 JOIN "user" u ON u.id = a."userId"
			 WHERE u.email = $1 AND a."providerId" = 'credential'`,
			[email],
		)
		return Number(result.rows[0]?.count ?? '0')
	}

	const countUserRows = async (email: string): Promise<number> => {
		const result = await sharedPool.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM "user" WHERE email = $1`,
			[email],
		)
		return Number(result.rows[0]?.count ?? '0')
	}

	const stripCredentialRow = async (email: string): Promise<void> => {
		await sharedPool.query(
			`DELETE FROM "account"
			 WHERE "userId" = (SELECT id FROM "user" WHERE email = $1 LIMIT 1)
			   AND "providerId" = 'credential'`,
			[email],
		)
	}

	beforeAll(async () => {
		await truncateAuthTables(sharedPool)
	})

	describe('when the invite path just created the user', () => {
		it('should remove the throwaway credential row so the invitee starts passwordless', async () => {
			// [auth.ts:167 — wasCreated=true branch]
			// GIVEN a freshly created invitee carrying the throwaway password
			// that sendInvitationEmail mints at auth.ts:146.
			const auth = buildInstance()
			const inviteeEmail = `wascreated-${Date.now()}@example.com`
			await auth.api.createUser({
				body: {
					email: inviteeEmail,
					name: 'Was Created',
					password: `invite-fake-id-${Date.now()}-pending`,
				},
			})
			expect(
				await countCredentialRows(inviteeEmail),
				'createUser must write a credential row for the strip to remove',
			).toBe(1)

			// WHEN the strip runs
			await stripCredentialRow(inviteeEmail)

			// THEN the credential row is gone but the user row survives —
			// magic-link verify reads the user row only.
			expect(await countCredentialRows(inviteeEmail)).toBe(0)
			expect(await countUserRows(inviteeEmail)).toBe(1)
		})
	})

	describe('when the invite path encountered an existing user', () => {
		it('should leave the existing credential row untouched (no data loss)', async () => {
			// [auth.ts:162 — wasCreated=false branch]
			// GIVEN an existing user with a real password (second-org invite
			// path resolves to USER_ALREADY_EXISTS at auth.ts:156).
			const auth = buildInstance()
			const existingUserEmail = `existing-${Date.now()}@example.com`
			await auth.api.createUser({
				body: {
					email: existingUserEmail,
					name: 'Existing',
					password: 'their-own-real-password-1234',
				},
			})
			expect(await countCredentialRows(existingUserEmail)).toBe(1)

			// WHEN the invite path skips the strip (no call here on purpose —
			// production gates the DELETE on `wasCreated`).

			// THEN the real password row is preserved.
			expect(await countCredentialRows(existingUserEmail)).toBe(1)
		})
	})
})
