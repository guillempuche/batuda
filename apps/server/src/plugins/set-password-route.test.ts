import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { admin, organization } from 'better-auth/plugins'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildBetterAuthConfig } from '@batuda/auth'

import { setPasswordRoute } from './set-password-route'

// Real Postgres on $DATABASE_URL — every email is prefixed so afterAll's
// scoped DELETE leaves the dev seed alone.

const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'
const BETTER_AUTH_SECRET = process.env['BETTER_AUTH_SECRET'] ?? 'test-secret'

const TEST_EMAIL_PREFIX = 'auth-it-setpwd-'

const sharedPool = new pg.Pool({ connectionString: DATABASE_URL })

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
			// `admin` exposes createUser (public sign-up is disabled);
			// `organization` is required by the shared config's
			// session.create.before hook that auto-picks the active org.
			plugins: [admin(), organization(), setPasswordRoute()],
		}),
	)

type AuthInstance = ReturnType<typeof buildInstance>

const createUser = async (
	auth: AuthInstance,
	label: string,
): Promise<{ email: string; password: string }> => {
	const email = `${TEST_EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
	const password = 'seed-password-1234'
	await auth.api.createUser({
		body: { email, name: label, password },
	})
	return { email, password }
}

const signInAndGetCookie = async (
	auth: AuthInstance,
	email: string,
	password: string,
): Promise<string> => {
	const result = await auth.api.signInEmail({
		returnHeaders: true,
		body: { email, password },
	})
	const cookie = result.headers.getSetCookie()[0]
	if (!cookie) throw new Error('signInEmail did not Set-Cookie')
	return cookie
}

const stripCredentialRow = async (email: string): Promise<void> => {
	await sharedPool.query(
		`DELETE FROM "account"
		 WHERE "userId" = (SELECT id FROM "user" WHERE email = $1 LIMIT 1)
		   AND "providerId" = 'credential'`,
		[email],
	)
}

afterAll(async () => {
	await sharedPool.query(
		`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[`${TEST_EMAIL_PREFIX}%`],
	)
	await sharedPool.query(
		`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
		[`${TEST_EMAIL_PREFIX}%`],
	)
	await sharedPool.query(`DELETE FROM "user" WHERE email LIKE $1`, [
		`${TEST_EMAIL_PREFIX}%`,
	])
	await sharedPool.end()
})

describe('POST /auth/set-password — passwordless user binds a first credential', () => {
	let auth: AuthInstance
	beforeAll(() => {
		auth = buildInstance()
	})

	describe('given a session for a passwordless user', () => {
		it('should write a credential row that signs in with the new password', async () => {
			// [set-password-route.ts:42 — no-credential-row branch]
			// GIVEN a user invited passwordless (we sign in via the throwaway
			// password and immediately strip the credential row, mirroring the
			// post-invite state at auth.ts:167)
			const { email, password } = await createUser(auth, 'fresh')
			const cookie = await signInAndGetCookie(auth, email, password)
			await stripCredentialRow(email)
			const newPassword = 'first-real-password-1234'

			// WHEN /auth/set-password is called
			const result = await auth.api.setPassword({
				headers: { cookie },
				body: { newPassword },
			})

			// THEN status:true is returned and the new credential signs in.
			expect(result).toEqual({ status: true })
			const reSignIn = await auth.api.signInEmail({
				returnHeaders: true,
				body: { email, password: newPassword },
			})
			expect(reSignIn.headers.getSetCookie()[0]).toBeTruthy()
		})
	})
})

describe('POST /auth/set-password — already-set guard', () => {
	let auth: AuthInstance
	beforeAll(() => {
		auth = buildInstance()
	})

	describe('given a user who already has a credential row', () => {
		it('should reject with PASSWORD_ALREADY_SET', async () => {
			// [set-password-route.ts:54 — credential-row-exists branch]
			// GIVEN a user with the seed password still in place (no strip)
			const { email, password } = await createUser(auth, 'has')
			const cookie = await signInAndGetCookie(auth, email, password)

			// WHEN /auth/set-password is called
			// THEN the route rejects to avoid overwriting an existing credential.
			await expect(
				auth.api.setPassword({
					headers: { cookie },
					body: { newPassword: 'a-different-password-9999' },
				}),
			).rejects.toBeInstanceOf(APIError)
		})
	})
})

describe('POST /auth/set-password — input validation', () => {
	let auth: AuthInstance
	beforeAll(() => {
		auth = buildInstance()
	})

	describe('given a 7-character password (Better Auth minimum is 8)', () => {
		it('should reject with PASSWORD_TOO_SHORT', async () => {
			// [set-password-route.ts:38 — length floor]
			// GIVEN a passwordless user
			const { email, password } = await createUser(auth, 'short')
			const cookie = await signInAndGetCookie(auth, email, password)
			await stripCredentialRow(email)

			// WHEN a short password is submitted
			// THEN the route rejects before touching the DB.
			await expect(
				auth.api.setPassword({
					headers: { cookie },
					body: { newPassword: '1234567' },
				}),
			).rejects.toBeInstanceOf(APIError)
		})
	})
})

describe('POST /auth/set-password — without a session', () => {
	let auth: AuthInstance
	beforeAll(() => {
		auth = buildInstance()
	})

	describe('when no cookie is sent', () => {
		it('should reject with UNAUTHORIZED before the handler runs', async () => {
			// [set-password-route.ts:34 — sensitiveSessionMiddleware gate]
			// GIVEN no cookie
			// WHEN /auth/set-password is invoked
			// THEN the middleware rejects before any password hash runs.
			await expect(
				auth.api.setPassword({
					headers: {},
					body: { newPassword: 'doesnt-matter-1234' },
				}),
			).rejects.toBeInstanceOf(APIError)
		})
	})
})
