import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import {
	admin,
	bearer,
	magicLink,
	openAPI,
	organization,
} from 'better-auth/plugins'
import { Effect } from 'effect'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	AlreadyMember,
	buildBetterAuthConfig,
	inviteAdmin,
	makeBetterAuthAdapter,
	OrgSlugTaken,
} from '@batuda/auth'

// Multi-org isolation contract — the only behaviours that genuinely need a
// real Postgres + RLS to verify. Everything else lives as unit tests or
// Playwright golden paths.
//
// Prerequisites:
//   - `pnpm cli services up` running (Postgres on $DATABASE_URL)
//   - The migration in apps/server/src/db/migrations/0001_initial.ts has run,
//     creating app_user / app_service roles and the org_isolation_* policies.
//
// Strategy:
//   - beforeAll: TRUNCATE every CRM + auth + email table, GRANT membership in
//     app_user/app_service to the current connecting user so SET ROLE works,
//     then seed three personas + two orgs + four memberships via Better Auth.
//   - Each RLS test: BEGIN ; SET LOCAL ROLE app_user ; SET LOCAL
//     app.current_org_id = $orgId ; assert ; ROLLBACK. Per-test rollback
//     keeps the persona seed intact across the whole describe block.
//   - inviteAdmin tests TRUNCATE the auth tables + re-seed the personas
//     each time because Better Auth opens its own transactions and our
//     ROLLBACK does not reach inside them.

// Fall back to the docker-compose default so the test runs without an
// explicit DATABASE_URL when the developer's .env isn't loaded into the
// vitest process. The dev container exposes Postgres on 5433.
const DATABASE_URL =
	process.env['DATABASE_URL'] ??
	'postgresql://batuda:batuda@localhost:5433/batuda'
const BETTER_AUTH_SECRET = process.env['BETTER_AUTH_SECRET'] ?? 'test-secret'

// Fixed persona definitions. Mirror DEMO_USERS / DEMO_ORGS / DEMO_MEMBERSHIPS
// in apps/cli/src/commands/seed.ts so the dev login keeps working alongside
// these tests. Duplicated rather than imported because apps/cli is not a
// library dependency of apps/server.
const PERSONAS = {
	alice: {
		email: 'admin@taller.cat',
		password: 'batuda-dev-2026',
		name: 'Alice Admin',
		role: 'admin' as const,
	},
	carol: {
		email: 'colleague@taller.cat',
		password: 'batuda-dev-2026',
		name: 'Carol Colleague',
		role: 'user' as const,
	},
	bob: {
		email: 'admin@restaurant.demo',
		password: 'batuda-dev-2026',
		name: 'Bob Owner',
		role: 'admin' as const,
	},
} as const

const ORGS = {
	taller: { slug: 'taller', name: 'Taller Demo' },
	restaurant: { slug: 'restaurant', name: 'Restaurant Demo' },
} as const

// Lists of tables the test owns. TRUNCATE order respects FK dependencies
// (CASCADE handles the rest). Only tables this test reads/writes — not the
// full CRM schema — to keep the dev DB's calendar/research/etc. fixtures
// untouched if the user is iterating on them in parallel.
const TABLES_TO_TRUNCATE = [
	'message_participants',
	'email_messages',
	'email_thread_links',
	'email_attachment_staging',
	'inbox_footers',
	'email_draft_bodies',
	'inboxes',
	'"member"',
	'"invitation"',
	'"organization"',
	'"session"',
	'"account"',
	'apikey',
	'"user"',
] as const

// Build a concrete Better Auth instance with full plugins so the inferred
// `auth.api.*` shape carries createUser / createOrganization / addMember.
// `ReturnType<typeof betterAuth>` would erase the plugin tuple and lose
// those endpoints from the type.
const buildTestAuth = (pool: pg.Pool) =>
	betterAuth(
		buildBetterAuthConfig({
			env: {
				secret: BETTER_AUTH_SECRET,
				baseURL: 'http://localhost:3010',
				useSecureCookies: false,
				trustedOrigins: [],
			},
			pool,
			plugins: [
				openAPI(),
				bearer(),
				admin(),
				organization(),
				apiKey({ enableSessionForAPIKeys: true }),
				magicLink({ sendMagicLink: async () => {} }),
			],
		}),
	)

type TestAuth = ReturnType<typeof buildTestAuth>

interface TestContext {
	pool: pg.Pool
	auth: TestAuth
	adapter: ReturnType<typeof makeBetterAuthAdapter>
	aliceId: string
	carolId: string
	bobId: string
	tallerOrgId: string
	restaurantOrgId: string
}

// Bypasses RLS by running as the table owner (the DATABASE_URL user). Used
// inside seedFixture and inside per-test seed blocks where we're staging
// data from "outside the app" before flipping to app_user for assertions.
const truncateAll = async (pool: pg.Pool): Promise<void> => {
	await pool.query(`TRUNCATE ${TABLES_TO_TRUNCATE.join(', ')} CASCADE`)
}

// Idempotent role grants so SET ROLE app_user works even on fresh containers
// where the dev `batuda` user wasn't previously a member.
const ensureRoleMembership = async (pool: pg.Pool): Promise<void> => {
	await pool.query('GRANT app_user TO CURRENT_USER')
	await pool.query('GRANT app_service TO CURRENT_USER')
}

const seedPersonas = async (
	auth: TestAuth,
	pool: pg.Pool,
): Promise<{
	aliceId: string
	carolId: string
	bobId: string
	tallerOrgId: string
	restaurantOrgId: string
}> => {
	for (const u of Object.values(PERSONAS)) {
		await auth.api.createUser({
			body: {
				email: u.email,
				password: u.password,
				name: u.name,
				role: u.role,
			},
		})
	}
	const ids = await pool.query<{ email: string; id: string }>(
		`SELECT email, id FROM "user" WHERE email = ANY($1)`,
		[Object.values(PERSONAS).map(p => p.email)],
	)
	const userIdByEmail = new Map(ids.rows.map(r => [r.email, r.id]))

	const aliceId = userIdByEmail.get(PERSONAS.alice.email)
	const carolId = userIdByEmail.get(PERSONAS.carol.email)
	const bobId = userIdByEmail.get(PERSONAS.bob.email)
	if (!aliceId || !carolId || !bobId) {
		throw new Error('persona user lookup failed after createUser')
	}

	const taller = await auth.api.createOrganization({
		body: { name: ORGS.taller.name, slug: ORGS.taller.slug, userId: aliceId },
	})
	const restaurant = await auth.api.createOrganization({
		body: {
			name: ORGS.restaurant.name,
			slug: ORGS.restaurant.slug,
			userId: bobId,
		},
	})
	if (!taller?.id || !restaurant?.id) {
		throw new Error('org create returned without id')
	}

	// Add carol as taller member, alice as restaurant member.
	await auth.api.addMember({
		body: { userId: carolId, organizationId: taller.id, role: 'member' },
	})
	await auth.api.addMember({
		body: { userId: aliceId, organizationId: restaurant.id, role: 'member' },
	})

	return {
		aliceId,
		carolId,
		bobId,
		tallerOrgId: taller.id,
		restaurantOrgId: restaurant.id,
	}
}

const ctx = {} as TestContext

beforeAll(async () => {
	if (!DATABASE_URL) {
		throw new Error('DATABASE_URL missing — run `pnpm cli services up` first')
	}
	const pool = new pg.Pool({ connectionString: DATABASE_URL })

	const auth = buildTestAuth(pool)

	const adapter = makeBetterAuthAdapter({
		env: {
			secret: BETTER_AUTH_SECRET,
			baseURL: 'http://localhost:3010',
			useSecureCookies: false,
			trustedOrigins: [],
		},
		pool,
		magicLinkSender: async () => {},
	})

	await ensureRoleMembership(pool)
	await truncateAll(pool)
	const ids = await seedPersonas(auth, pool)

	ctx.pool = pool
	ctx.auth = auth
	ctx.adapter = adapter
	ctx.aliceId = ids.aliceId
	ctx.carolId = ids.carolId
	ctx.bobId = ids.bobId
	ctx.tallerOrgId = ids.tallerOrgId
	ctx.restaurantOrgId = ids.restaurantOrgId
}, 60_000)

afterAll(async () => {
	await ctx.pool?.end()
})

// Inserts test data inside a transaction owned by the connecting user
// (bypasses RLS, since the table owner skips RLS by default without FORCE).
// Tests then issue SET LOCAL ROLE app_user inside the same transaction
// before assertions, and ROLLBACK at the end so no data leaks across tests.
const withSuper = async <T>(
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
	const client = await ctx.pool.connect()
	try {
		await client.query('BEGIN')
		const result = await fn(client)
		await client.query('ROLLBACK')
		return result
	} finally {
		client.release()
	}
}

const fakeInbox = (orgId: string, ownerUserId: string, email: string) => ({
	organization_id: orgId,
	owner_user_id: ownerUserId,
	email,
	purpose: 'human',
	imap_host: 'imap.example.com',
	imap_port: 993,
	imap_security: 'tls',
	smtp_host: 'smtp.example.com',
	smtp_port: 465,
	smtp_security: 'tls',
	username: email,
	password_ciphertext: Buffer.from('x'),
	password_nonce: Buffer.from('x'),
	password_tag: Buffer.from('x'),
})

describe('multi-org isolation', () => {
	describe('RLS USING-clause stripping', () => {
		it('inboxes selected as app_user with current_org_id=taller hides restaurant inboxes', async () => {
			// GIVEN one inbox in each org
			// WHEN selecting * from inboxes as app_user with current_org_id=taller
			// THEN only the taller row is visible
			const tallerInbox = fakeInbox(
				ctx.tallerOrgId,
				ctx.aliceId,
				'alice@taller.cat',
			)
			const restaurantInbox = fakeInbox(
				ctx.restaurantOrgId,
				ctx.bobId,
				'bob@restaurant.demo',
			)
			await withSuper(async client => {
				await client.query(
					`INSERT INTO inboxes (${Object.keys(tallerInbox).join(',')}) VALUES (${Object.keys(
						tallerInbox,
					)
						.map((_, i) => `$${i + 1}`)
						.join(',')})`,
					Object.values(tallerInbox),
				)
				await client.query(
					`INSERT INTO inboxes (${Object.keys(restaurantInbox).join(',')}) VALUES (${Object.keys(
						restaurantInbox,
					)
						.map((_, i) => `$${i + 1}`)
						.join(',')})`,
					Object.values(restaurantInbox),
				)
				await client.query(`SET LOCAL ROLE app_user`)
				await client.query(
					`SET LOCAL app.current_org_id = '${ctx.tallerOrgId}'`,
				)
				const visible = await client.query<{ organization_id: string }>(
					'SELECT organization_id FROM inboxes',
				)
				expect(visible.rows.length).toBe(1)
				expect(visible.rows[0]?.organization_id).toBe(ctx.tallerOrgId)
			})
		})

		it('email_messages selected without WHERE organization_id still strips cross-org', async () => {
			// GIVEN one outbound message in each org's inbox
			// WHEN selecting * from email_messages without a WHERE clause as app_user (taller)
			// THEN only the taller row is visible — RLS USING fires regardless of query shape
			await withSuper(async client => {
				const inboxIns = await client.query<{ id: string }>(
					`INSERT INTO inboxes (organization_id, owner_user_id, email, purpose, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, password_ciphertext, password_nonce, password_tag)
					 VALUES ($1,$2,$3,'human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x'),
					        ($4,$5,$6,'human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x') RETURNING id, organization_id`,
					[
						ctx.tallerOrgId,
						ctx.aliceId,
						'a@a',
						ctx.restaurantOrgId,
						ctx.bobId,
						'b@b',
					],
				)
				const tallerInboxId = inboxIns.rows[0]?.id
				const restaurantInboxId = inboxIns.rows[1]?.id

				await client.query(
					`INSERT INTO email_messages (organization_id, inbox_id, message_id, direction, folder, raw_rfc822_ref, status)
					 VALUES ($1,$2,'<m1@x>','outbound','Sent','r/1','normal'),
					        ($3,$4,'<m2@x>','outbound','Sent','r/2','normal')`,
					[
						ctx.tallerOrgId,
						tallerInboxId,
						ctx.restaurantOrgId,
						restaurantInboxId,
					],
				)

				await client.query(`SET LOCAL ROLE app_user`)
				await client.query(
					`SET LOCAL app.current_org_id = '${ctx.tallerOrgId}'`,
				)
				const all = await client.query<{ organization_id: string }>(
					'SELECT organization_id FROM email_messages',
				)
				expect(all.rows.length).toBe(1)
				expect(all.rows[0]?.organization_id).toBe(ctx.tallerOrgId)
			})
		})

		it('email_thread_links is org-scoped under RLS', async () => {
			// GIVEN one thread per org pinned to a per-org inbox
			// WHEN selecting from email_thread_links as app_user (taller)
			// THEN only taller's thread row is visible
			await withSuper(async client => {
				const inboxIns = await client.query<{ id: string }>(
					`INSERT INTO inboxes (organization_id, owner_user_id, email, purpose, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, password_ciphertext, password_nonce, password_tag)
					 VALUES ($1,$2,'a@a','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x'),
					        ($3,$4,'b@b','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x') RETURNING id`,
					[ctx.tallerOrgId, ctx.aliceId, ctx.restaurantOrgId, ctx.bobId],
				)
				await client.query(
					`INSERT INTO email_thread_links (organization_id, external_thread_id, inbox_id)
					 VALUES ($1, '<t1@x>', $2), ($3, '<t2@x>', $4)`,
					[
						ctx.tallerOrgId,
						inboxIns.rows[0]?.id,
						ctx.restaurantOrgId,
						inboxIns.rows[1]?.id,
					],
				)
				await client.query(`SET LOCAL ROLE app_user`)
				await client.query(
					`SET LOCAL app.current_org_id = '${ctx.tallerOrgId}'`,
				)
				const visible = await client.query(
					'SELECT organization_id FROM email_thread_links',
				)
				expect(visible.rows.length).toBe(1)
			})
		})

		it('message_participants is transitively scoped via email_messages subquery policy', async () => {
			// GIVEN a message + participant row in each org
			// WHEN selecting message_participants as app_user (taller)
			// THEN only the taller participant is visible — proves the EXISTS subquery policy
			await withSuper(async client => {
				const inboxIns = await client.query<{ id: string }>(
					`INSERT INTO inboxes (organization_id, owner_user_id, email, purpose, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, password_ciphertext, password_nonce, password_tag)
					 VALUES ($1,$2,'a@a','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x'),
					        ($3,$4,'b@b','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x') RETURNING id`,
					[ctx.tallerOrgId, ctx.aliceId, ctx.restaurantOrgId, ctx.bobId],
				)
				const msgIns = await client.query<{ id: string }>(
					`INSERT INTO email_messages (organization_id, inbox_id, message_id, direction, folder, raw_rfc822_ref, status)
					 VALUES ($1,$2,'<m1@x>','outbound','Sent','r/1','normal'),
					        ($3,$4,'<m2@x>','outbound','Sent','r/2','normal') RETURNING id`,
					[
						ctx.tallerOrgId,
						inboxIns.rows[0]?.id,
						ctx.restaurantOrgId,
						inboxIns.rows[1]?.id,
					],
				)
				await client.query(
					`INSERT INTO message_participants (email_message_id, email_address, role)
					 VALUES ($1, 'x@x', 'to'), ($2, 'y@y', 'to')`,
					[msgIns.rows[0]?.id, msgIns.rows[1]?.id],
				)
				await client.query(`SET LOCAL ROLE app_user`)
				await client.query(
					`SET LOCAL app.current_org_id = '${ctx.tallerOrgId}'`,
				)
				const visible = await client.query<{ email_address: string }>(
					'SELECT email_address FROM message_participants',
				)
				expect(visible.rows.length).toBe(1)
				expect(visible.rows[0]?.email_address).toBe('x@x')
			})
		})
	})

	describe('DB-level invariants', () => {
		it("CHECK rejects purpose='shared' + is_private=true on insert", async () => {
			// GIVEN an attempt to create a shared inbox marked private (nonsensical)
			// WHEN INSERT runs
			// THEN the table-level CHECK constraint rejects it
			await expect(
				ctx.pool.query(
					`INSERT INTO inboxes (organization_id, owner_user_id, email, purpose, is_private, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, password_ciphertext, password_nonce, password_tag)
					 VALUES ($1, NULL, 'shared@x', 'shared', true, 'x', 1, 'tls', 'x', 1, 'tls', 'u', '\\x', '\\x', '\\x')`,
					[ctx.tallerOrgId],
				),
			).rejects.toThrow(/inboxes_purpose_owner_chk|check constraint/i)
		})

		it('idx_email_messages_msgid is org-scoped (same Message-ID across orgs allowed; within an org rejected)', async () => {
			// GIVEN the same Message-ID present in both orgs
			// WHEN INSERT runs
			// THEN the unique index allows it (org pair makes it unique)
			// AND a duplicate within the same org is rejected
			await withSuper(async client => {
				const inboxIns = await client.query<{ id: string }>(
					`INSERT INTO inboxes (organization_id, owner_user_id, email, purpose, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, password_ciphertext, password_nonce, password_tag)
					 VALUES ($1,$2,'a@a','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x'),
					        ($3,$4,'b@b','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x') RETURNING id`,
					[ctx.tallerOrgId, ctx.aliceId, ctx.restaurantOrgId, ctx.bobId],
				)
				// Same Message-ID in two different orgs — allowed.
				await client.query(
					`INSERT INTO email_messages (organization_id, inbox_id, message_id, direction, folder, raw_rfc822_ref, status)
					 VALUES ($1,$2,'<shared@x>','outbound','Sent','r/1','normal'),
					        ($3,$4,'<shared@x>','outbound','Sent','r/2','normal')`,
					[
						ctx.tallerOrgId,
						inboxIns.rows[0]?.id,
						ctx.restaurantOrgId,
						inboxIns.rows[1]?.id,
					],
				)
				// Duplicate inside the same org — rejected.
				await expect(
					client.query(
						`INSERT INTO email_messages (organization_id, inbox_id, message_id, direction, folder, raw_rfc822_ref, status)
						 VALUES ($1, $2, '<shared@x>', 'outbound', 'Sent', 'r/3', 'normal')`,
						[ctx.tallerOrgId, inboxIns.rows[0]?.id],
					),
				).rejects.toThrow(/duplicate key|unique/i)
			})
		})

		it('member.primary_inbox_id is nulled when the referenced inbox row is deleted', async () => {
			// GIVEN a member with primary_inbox_id pointing at an inbox row
			// WHEN the inbox row is deleted
			// THEN ON DELETE SET NULL fires and the member's primary_inbox_id reads NULL
			await withSuper(async client => {
				const inboxIns = await client.query<{ id: string }>(
					`INSERT INTO inboxes (organization_id, owner_user_id, email, purpose, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, username, password_ciphertext, password_nonce, password_tag)
					 VALUES ($1,$2,'a@a','human','x',1,'tls','x',1,'tls','u','\\x','\\x','\\x') RETURNING id`,
					[ctx.tallerOrgId, ctx.aliceId],
				)
				const inboxId = inboxIns.rows[0]?.id
				await client.query(
					`UPDATE "member" SET primary_inbox_id = $1 WHERE "userId" = $2 AND "organizationId" = $3`,
					[inboxId, ctx.aliceId, ctx.tallerOrgId],
				)
				await client.query(`DELETE FROM inboxes WHERE id = $1`, [inboxId])
				const after = await client.query<{ primary_inbox_id: string | null }>(
					`SELECT primary_inbox_id FROM "member" WHERE "userId" = $1 AND "organizationId" = $2`,
					[ctx.aliceId, ctx.tallerOrgId],
				)
				expect(after.rows[0]?.primary_inbox_id).toBeNull()
			})
		})
	})

	describe('inviteAdmin orchestration', () => {
		// Better Auth's createUser/createOrganization/addMember each open
		// their own transaction, so per-test ROLLBACK does not undo their
		// writes. Reset auth state explicitly between invite-admin cases.
		const resetAuth = async () => {
			await truncateAll(ctx.pool)
			const ids = await seedPersonas(ctx.auth, ctx.pool)
			ctx.aliceId = ids.aliceId
			ctx.carolId = ids.carolId
			ctx.bobId = ids.bobId
			ctx.tallerOrgId = ids.tallerOrgId
			ctx.restaurantOrgId = ids.restaurantOrgId
		}

		it('creates org + user + owner membership + magic-link in one shot for a fresh slug', async () => {
			// GIVEN no org with slug='newco' and no user with email='new@x.com'
			// WHEN inviteAdmin runs
			// THEN organization + user + owner membership exist; magicLink.send is invoked
			await resetAuth()
			let captured = 0
			const result = await Effect.runPromise(
				inviteAdmin(
					ctx.adapter.users,
					ctx.adapter.organizations,
					ctx.adapter.members,
					{ send: () => Effect.sync(() => void captured++) },
					{
						email: 'new@x.com',
						name: 'New',
						orgName: 'NewCo',
						orgSlug: 'newco',
					},
				),
			)
			expect(result.assignedRole).toBe('owner')
			expect(result.magicLinkSent).toBe(true)
			expect(captured).toBe(1)

			const orgRow = await ctx.pool.query<{ id: string }>(
				`SELECT id FROM "organization" WHERE slug = 'newco'`,
			)
			expect(orgRow.rows[0]?.id).toBe(result.organizationId)
			const memberRow = await ctx.pool.query<{ role: string }>(
				`SELECT role FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`,
				[result.organizationId, result.user.id],
			)
			expect(memberRow.rows[0]?.role).toBe('owner')
		})

		it('rejects with OrgSlugTaken and writes nothing when slug exists and allowExistingOrg is false', async () => {
			// GIVEN org with slug='taller' already exists
			// WHEN inviteAdmin runs with that slug + a brand-new email + no allowExistingOrg
			// THEN it fails OrgSlugTaken and no new user row is created
			await resetAuth()
			const before = await ctx.pool.query<{ count: string }>(
				`SELECT count(*)::text AS count FROM "user"`,
			)
			const result = await Effect.runPromise(
				Effect.result(
					inviteAdmin(
						ctx.adapter.users,
						ctx.adapter.organizations,
						ctx.adapter.members,
						{ send: () => Effect.void },
						{
							email: 'never-created@x.com',
							name: 'Never',
							orgName: 'Taller Demo',
							orgSlug: 'taller',
						},
					),
				),
			)
			expect(result._tag).toBe('Failure')
			if (result._tag === 'Failure') {
				expect(result.failure).toBeInstanceOf(OrgSlugTaken)
			}
			const after = await ctx.pool.query<{ count: string }>(
				`SELECT count(*)::text AS count FROM "user"`,
			)
			expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
		})

		it('attaches as admin (not owner) when allowExistingOrg=true and slug exists', async () => {
			// GIVEN slug='restaurant' already exists with bob as owner
			// WHEN inviteAdmin runs with that slug + a brand-new email + allowExistingOrg=true
			// THEN the user is attached to the existing org as 'admin'
			// AND assignedRole reflects the join role, not the org's creator role
			await resetAuth()
			const result = await Effect.runPromise(
				inviteAdmin(
					ctx.adapter.users,
					ctx.adapter.organizations,
					ctx.adapter.members,
					{ send: () => Effect.void },
					{
						email: 'second-admin@x.com',
						name: 'Second',
						orgName: 'Restaurant Demo',
						orgSlug: 'restaurant',
						allowExistingOrg: true,
					},
				),
			)
			expect(result.assignedRole).toBe('admin')
			expect(result.organizationId).toBe(ctx.restaurantOrgId)
			const membership = await ctx.pool.query<{ role: string }>(
				`SELECT role FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`,
				[result.organizationId, result.user.id],
			)
			expect(membership.rows[0]?.role).toBe('admin')
		})

		it('surfaces AlreadyMember when the user already belongs to the target org', async () => {
			// GIVEN alice is already a member of restaurant
			// WHEN inviteAdmin runs with allowExistingOrg=true for alice@taller.cat under restaurant
			// THEN it fails with AlreadyMember and writes no extra membership row
			await resetAuth()
			const before = await ctx.pool.query<{ count: string }>(
				`SELECT count(*)::text AS count FROM "member" WHERE "userId" = $1`,
				[ctx.aliceId],
			)
			const result = await Effect.runPromise(
				Effect.result(
					inviteAdmin(
						ctx.adapter.users,
						ctx.adapter.organizations,
						ctx.adapter.members,
						{ send: () => Effect.void },
						{
							email: PERSONAS.alice.email,
							name: PERSONAS.alice.name,
							orgName: 'Restaurant Demo',
							orgSlug: 'restaurant',
							allowExistingOrg: true,
						},
					),
				),
			)
			expect(result._tag).toBe('Failure')
			if (result._tag === 'Failure') {
				expect(result.failure).toBeInstanceOf(AlreadyMember)
			}
			const after = await ctx.pool.query<{ count: string }>(
				`SELECT count(*)::text AS count FROM "member" WHERE "userId" = $1`,
				[ctx.aliceId],
			)
			expect(after.rows[0]?.count).toBe(before.rows[0]?.count)
		})
	})

	describe('session.create databaseHook', () => {
		it('auto-sets activeOrganizationId when the user has exactly one membership', async () => {
			// GIVEN bob is the sole owner of restaurant and a member of nowhere else
			// WHEN bob signs in and a session is created
			// THEN session.activeOrganizationId equals restaurant.id
			const result = await ctx.auth.api.signInEmail({
				body: {
					email: PERSONAS.bob.email,
					password: PERSONAS.bob.password,
				},
				returnHeaders: true,
			})
			const session = (
				result as unknown as {
					response: { user: { id: string } }
					headers: Headers
				}
			).response
			// Re-read the session row to inspect activeOrganizationId — the hook
			// runs before insert, so the column reflects the auto-pick.
			const row = await ctx.pool.query<{ activeOrganizationId: string | null }>(
				`SELECT "activeOrganizationId" FROM "session" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
				[session.user.id],
			)
			expect(row.rows[0]?.activeOrganizationId).toBe(ctx.restaurantOrgId)
		})

		it('leaves activeOrganizationId unset when the user has multiple memberships', async () => {
			// GIVEN alice belongs to both taller (owner) and restaurant (member)
			// WHEN she signs in and a session is created
			// THEN session.activeOrganizationId is null — multi-org users must pick
			const result = await ctx.auth.api.signInEmail({
				body: {
					email: PERSONAS.alice.email,
					password: PERSONAS.alice.password,
				},
				returnHeaders: true,
			})
			const session = (
				result as unknown as { response: { user: { id: string } } }
			).response
			const row = await ctx.pool.query<{ activeOrganizationId: string | null }>(
				`SELECT "activeOrganizationId" FROM "session" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
				[session.user.id],
			)
			expect(row.rows[0]?.activeOrganizationId).toBeNull()
		})
	})
})
