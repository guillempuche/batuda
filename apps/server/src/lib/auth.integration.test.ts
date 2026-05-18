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
// migrations applied. Every email this test mints starts with the
// auth-it- prefix so afterAll can scope DELETEs to its own rows —
// TRUNCATE would wipe the seeded taller/restaurant orgs that sibling
// test files depend on.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'
const BETTER_AUTH_SECRET = process.env['BETTER_AUTH_SECRET'] ?? 'test-secret'

const TEST_EMAIL_PREFIX = 'auth-it-'

const sharedPool = new pg.Pool({ connectionString: DATABASE_URL })

afterAll(async () => {
	// Remove only the rows we wrote so the seed survives for sibling tests.
	await sharedPool.query(
		`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[`${TEST_EMAIL_PREFIX}%`],
	)
	await sharedPool.query(`DELETE FROM "user" WHERE email LIKE $1`, [
		`${TEST_EMAIL_PREFIX}%`,
	])
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

	beforeAll(() => {
		capturedSends = []
	})

	describe('when /sign-in/magic-link is called with an unregistered email', () => {
		it('should return status:true without invoking sendMagicLink', async () => {
			// [auth.ts:206 — unknown-email branch]
			// GIVEN a fresh betterAuth instance and an email not in "user"
			const auth = buildInstance()
			const unregisteredEmail = `${TEST_EMAIL_PREFIX}noone-${Date.now()}@example.invalid`

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
			const registeredEmail = `${TEST_EMAIL_PREFIX}known-${Date.now()}@example.com`
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

describe('admin createUser respects an omitted password', () => {
	// Pins the Better Auth contract that callers (web invitation flow,
	// CLI `users.createPasswordless`) lean on: no `password` => no
	// `account` row, so invitees start passwordless.

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

	describe('when password is omitted', () => {
		it('should create the user without a credential row', async () => {
			// [better-auth/dist/plugins/admin/routes.mjs:170 — `if (ctx.body.password)` gate is false]
			// GIVEN a fresh invitee email and an instance with the admin plugin
			const auth = buildInstance()
			const inviteeEmail = `${TEST_EMAIL_PREFIX}nopwd-${Date.now()}@example.com`

			// WHEN createUser is called with no password field
			await auth.api.createUser({
				body: {
					email: inviteeEmail,
					name: 'No Password',
				},
			})

			// THEN the user row is written but the credential row is skipped —
			// magic-link verify reads `findUserByEmail` so the user can sign in.
			expect(await countUserRows(inviteeEmail)).toBe(1)
			expect(await countCredentialRows(inviteeEmail)).toBe(0)
		})
	})

	describe('when password is provided', () => {
		it('should write a credential row alongside the user', async () => {
			// [better-auth/dist/plugins/admin/routes.mjs:170 — `if (ctx.body.password)` gate is true]
			// GIVEN an email and a real password (matches the second-org
			// invite path: the user already has a password from a prior org).
			const auth = buildInstance()
			const userEmail = `${TEST_EMAIL_PREFIX}haspwd-${Date.now()}@example.com`

			// WHEN createUser is called with a password
			await auth.api.createUser({
				body: {
					email: userEmail,
					name: 'Has Password',
					password: 'their-own-real-password-1234',
				},
			})

			// THEN both rows exist — confirms `password` is the only switch.
			expect(await countUserRows(userEmail)).toBe(1)
			expect(await countCredentialRows(userEmail)).toBe(1)
		})
	})
})
