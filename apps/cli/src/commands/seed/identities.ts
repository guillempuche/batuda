import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { admin, bearer, openAPI, organization } from 'better-auth/plugins'
import { adminAc, defaultAc } from 'better-auth/plugins/admin/access'
import { Config, Effect, Redacted } from 'effect'
import pg from 'pg'

import { buildBetterAuthConfig } from '@batuda/auth'

import { DEMO_MEMBERSHIPS, DEMO_ORGS, DEMO_USERS } from './fixtures'

export const seedIdentities = Effect.gen(function* () {
	yield* Effect.logInfo('Seeding orgs, users, memberships...')
	const dbUrl = yield* Config.redacted('DATABASE_URL')
	const secret = yield* Config.string('BETTER_AUTH_SECRET')
	const baseURL = yield* Config.string('BETTER_AUTH_BASE_URL').pipe(
		Config.withDefault('http://localhost:3010'),
	)

	const pool = new pg.Pool({ connectionString: Redacted.value(dbUrl) })

	// Fail fast on orphan CRM rows; a partial reset would mint fresh org ids and RLS would hide everything.
	const orphanCheck = yield* Effect.tryPromise({
		try: () =>
			pool.query<{ table: string; orphan_count: string }>(`
					SELECT 'companies' AS table, count(*)::text AS orphan_count
					FROM companies c
					WHERE NOT EXISTS (
						SELECT 1 FROM organization o WHERE o.id = c.organization_id
					)
					UNION ALL
					SELECT 'contacts', count(*)::text
					FROM contacts c
					WHERE NOT EXISTS (
						SELECT 1 FROM organization o WHERE o.id = c.organization_id
					)
				`),
		catch: cause => new Error(String(cause)),
	})
	const orphanRows = orphanCheck.rows.filter(r => Number(r.orphan_count) > 0)
	if (orphanRows.length > 0) {
		yield* Effect.promise(() => pool.end())
		const summary = orphanRows
			.map(r => `${r.table}=${r.orphan_count}`)
			.join(', ')
		return yield* Effect.fail(
			new Error(
				`CRM data references organization ids that no longer exist (${summary}). ` +
					'This usually means the auth tables were reset without re-seeding ' +
					'the CRM rows. Run `pnpm cli db reset && pnpm cli seed` for a clean slate.',
			),
		)
	}
	const auth = betterAuth(
		buildBetterAuthConfig({
			env: {
				secret,
				baseURL,
				useSecureCookies: false,
				trustedOrigins: [],
			},
			pool,
			plugins: [
				openAPI(),
				bearer(),
				admin({
					adminRoles: ['admin', 'app_service'],
					roles: {
						admin: adminAc,
						user: defaultAc.newRole({ user: [], session: [] }),
						app_service: adminAc,
					},
				}),
				organization(),
				apiKey({ enableSessionForAPIKeys: false }),
			],
		}),
	)

	// Users first: createOrganization needs a `userId` to attach the owner atomically.
	const userIdsByEmail = new Map<string, string>()
	for (const u of DEMO_USERS) {
		yield* Effect.tryPromise(() =>
			auth.api.createUser({
				body: {
					email: u.email,
					password: u.password,
					name: u.name,
					// `app_service` is valid at runtime; static role type stays narrow.
					role: u.role as 'admin' | 'user',
				},
			}),
		).pipe(
			Effect.tap(() => Effect.logInfo(`  user: ${u.email}`)),
			Effect.catchCause(cause =>
				Effect.logInfo(
					`  user create failed (will keep going): ${u.email} — ${String(cause)}`,
				),
			),
		)
		const found = yield* Effect.tryPromise({
			try: () =>
				pool.query<{ id: string }>(
					'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
					[u.email],
				),
			catch: cause => new Error(String(cause)),
		})
		const row = found.rows[0]
		if (row) userIdsByEmail.set(u.email, row.id)
	}

	const orgIdsBySlug = new Map<string, string>()
	for (const o of DEMO_ORGS) {
		const firstOwner = DEMO_MEMBERSHIPS.find(
			m => m.orgSlug === o.slug && m.role === 'owner',
		)
		const ownerUserId = firstOwner
			? userIdsByEmail.get(firstOwner.email)
			: undefined
		if (!ownerUserId) {
			yield* Effect.logInfo(`  org skipped (no owner resolved): ${o.slug}`)
			continue
		}
		yield* Effect.promise(() =>
			auth.api.createOrganization({
				body: { name: o.name, slug: o.slug, userId: ownerUserId },
			}),
		).pipe(
			Effect.tap(() => Effect.logInfo(`  org: ${o.slug}`)),
			Effect.catchCause(() =>
				Effect.logInfo(`  org already exists: ${o.slug}`),
			),
		)
		const found = yield* Effect.tryPromise({
			try: () =>
				pool.query<{ id: string }>(
					'SELECT id FROM "organization" WHERE slug = $1 LIMIT 1',
					[o.slug],
				),
			catch: cause => new Error(String(cause)),
		})
		const row = found.rows[0]
		if (row) orgIdsBySlug.set(o.slug, row.id)
	}

	// Owner memberships are already attached via createOrganization.
	for (const m of DEMO_MEMBERSHIPS) {
		if (m.role === 'owner') continue
		const userId = userIdsByEmail.get(m.email)
		const orgId = orgIdsBySlug.get(m.orgSlug)
		if (!userId || !orgId) continue
		yield* Effect.promise(() =>
			auth.api.addMember({
				body: { userId, organizationId: orgId, role: m.role },
			}),
		).pipe(
			Effect.tap(() =>
				Effect.logInfo(`  member: ${m.email} → ${m.orgSlug} (${m.role})`),
			),
			Effect.catchCause(() =>
				Effect.logInfo(`  member already exists: ${m.email} → ${m.orgSlug}`),
			),
		)
	}

	const emailWidth = Math.max(...DEMO_USERS.map(u => u.email.length))
	const pwWidth = Math.max(...DEMO_USERS.map(u => u.password.length))
	const nameWidth = Math.max(...DEMO_USERS.map(u => u.name.length))

	yield* Effect.logInfo('')
	yield* Effect.logInfo('─── Demo users (sign in with any of these) ───')
	for (const u of DEMO_USERS) {
		const memberships = DEMO_MEMBERSHIPS.filter(m => m.email === u.email)
			.map(m => `${m.orgSlug} (${m.role})`)
			.join(', ')
		yield* Effect.logInfo(
			`  ${u.email.padEnd(emailWidth)}  ${u.password.padEnd(pwWidth)}  ${u.name.padEnd(nameWidth)}  → ${memberships}`,
		)
	}
	yield* Effect.logInfo('')
	yield* Effect.logInfo(`Sign-in URL: ${baseURL}/auth/sign-in/email`)

	yield* Effect.promise(() => pool.end())
})
