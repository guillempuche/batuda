// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import { provideOrg } from '../middleware/org.js'
import { OrgResolution } from '../services/org-resolution.js'

// Function-level integration test for the org-resolution + provideOrg
// pipeline that webhooks-calcom.ts wires up (lines ~140-170 of the
// handler). The full HTTP path (signature verification, schema decode,
// dispatch through CalendarService) is exercised by the running dev
// stack during manual webhook delivery — see the plan's Verification
// section. This test pins the contract that:
//
//   1. resolveOrgForCalcomWebhook(payload) returns the matching org for
//      a known cal.com booking.
//   2. provideOrg(org)(effect) makes CurrentOrg AND `app.current_org_id`
//      reach the inner effect — so any SQL the CalendarService runs
//      passes RLS as `app_user`.
//
// Without this, the latent bug from before the slice (missing
// CurrentOrg + missing app.current_org_id) silently re-introduces
// itself the next time someone refactors the handler.

const TALLER = 'taller'

interface OrgIds {
	taller: string
}

const fetchTallerId = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql<{ id: string }>`
		SELECT id FROM "organization" WHERE slug = ${TALLER} LIMIT 1
	`
	const id = rows[0]?.id
	if (!id) {
		throw new Error("taller org missing — run 'pnpm cli db reset' first")
	}
	return { taller: id }
})

const insertCalcomEvent = (args: {
	id: string
	orgId: string
	icalUid: string
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SET LOCAL ROLE app_service`
		yield* sql`
			INSERT INTO calendar_events (
				id, organization_id, source, provider, provider_booking_id,
				ical_uid, ical_sequence, start_at, end_at, status, title,
				location_type, organizer_email
			) VALUES (
				${args.id}::uuid, ${args.orgId}, 'booking', 'calcom',
				${`booking-${args.id}`},
				${args.icalUid}, 0,
				now() + interval '7 days',
				now() + interval '7 days 30 minutes',
				'confirmed', 'Webhook test',
				'video', 'organizer@taller.cat'
			)
		`
	})

const cleanupEvent = (id: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SET LOCAL ROLE app_service`
		yield* sql`DELETE FROM calendar_events WHERE id = ${id}::uuid`
	})

// `multi-org-isolation.test.ts` TRUNCATEs `inboxes` between runs, so we
// can't rely on the seed's admin@taller.cat inbox being there. Use a
// dedicated fixture email scoped to this test instead.
const FIXTURE_INBOX_EMAIL = 'webhooks-calcom-fixture@taller.test'

const ensureFixtureInbox = (orgId: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SET LOCAL ROLE app_service`
		const placeholder = new Uint8Array([0])
		yield* sql`
			INSERT INTO inboxes (
				organization_id, email, purpose, owner_user_id,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security,
				username, password_ciphertext, password_nonce, password_tag,
				active
			) VALUES (
				${orgId}, ${FIXTURE_INBOX_EMAIL}, 'human', 'webhooks-calcom-test-user',
				'imap.test', 993, 'tls',
				'smtp.test', 587, 'starttls',
				${FIXTURE_INBOX_EMAIL}, ${placeholder}, ${placeholder}, ${placeholder},
				true
			)
			ON CONFLICT DO NOTHING
		`
	})

const cleanupFixtureInbox = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`SET LOCAL ROLE app_service`
	yield* sql`DELETE FROM inboxes WHERE email = ${FIXTURE_INBOX_EMAIL}`
})

describe('webhook org-resolution + provideOrg pipeline', () => {
	let orgIds: OrgIds
	const seededEvents: string[] = []

	beforeAll(async () => {
		orgIds = await Effect.runPromise(
			fetchTallerId.pipe(Effect.provide(PgLive)) as Effect.Effect<
				OrgIds,
				never,
				never
			>,
		)
		await Effect.runPromise(
			ensureFixtureInbox(orgIds.taller).pipe(
				Effect.provide(PgLive),
			) as Effect.Effect<void, never, never>,
		)
	})

	afterAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				for (const id of seededEvents) yield* cleanupEvent(id)
				yield* cleanupFixtureInbox
			}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
		)
	})

	describe('when a signed envelope resolves to a known org via iCalUID', () => {
		it('should provide CurrentOrg AND set app.current_org_id for downstream SQL', async () => {
			// GIVEN a calendar_events row with provider=calcom + source=booking in taller
			// WHEN resolveOrgForCalcomWebhook(payload) returns taller AND
			//      provideOrg(taller) wraps an inner effect that yields CurrentOrg
			//      and reads current_setting('app.current_org_id')
			// THEN the inner effect sees CurrentOrg.id === taller.id
			//      AND current_setting === taller.id
			// [webhooks-calcom.ts:135-174 — handler chain]
			// [middleware/org.ts:64-90 — provideOrg]
			const eventId = randomUUID()
			const icalUid = `webhook-test-${eventId}`
			seededEvents.push(eventId)

			const inner = Effect.gen(function* () {
				const currentOrg = yield* CurrentOrg
				const sql = yield* SqlClient.SqlClient
				const rows = yield* sql<{ orgId: string | null }>`
					SELECT current_setting('app.current_org_id', true) AS "orgId"
				`
				return {
					currentOrgId: currentOrg.id,
					currentOrgSlug: currentOrg.slug,
					settingOrgId: rows[0]?.orgId ?? null,
				}
			})

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					// Seed the event under app_service so we can resolve later.
					yield* insertCalcomEvent({
						id: eventId,
						orgId: orgIds.taller,
						icalUid,
					})

					// Resolve as the webhook handler would.
					const orgRes = yield* OrgResolution
					const org = yield* orgRes.resolveOrgForCalcomWebhook({
						iCalUID: icalUid,
					} as never)

					// Then run the inner effect through provideOrg.
					return yield* provideOrg(org)(inner)
				}).pipe(
					Effect.provide(OrgResolution.layer),
					Effect.provide(PgLive),
				) as Effect.Effect<
					{
						currentOrgId: string
						currentOrgSlug: string
						settingOrgId: string | null
					},
					never,
					never
				>,
			)

			expect(result.currentOrgId).toBe(orgIds.taller)
			expect(result.currentOrgSlug).toBe(TALLER)
			expect(result.settingOrgId).toBe(orgIds.taller)
		})
	})

	describe("when provideOrg's inner effect runs as app_user against an org-scoped table", () => {
		it('should pass the org_isolation RLS WITH CHECK clause', async () => {
			// GIVEN provideOrg(taller) has set app.current_org_id and SET ROLE app_user
			// WHEN the inner effect INSERTs a row that includes organization_id = taller.id
			// THEN the org_isolation_calendar_events policy approves the write
			//      AND the row is queryable from inside the same tx
			// [middleware/org.ts:75-79 — SET LOCAL ROLE app_user]
			// [migrations/0001_initial.ts — org_isolation_calendar_events policy]
			const eventId = randomUUID()
			const icalUid = `rls-test-${eventId}`
			seededEvents.push(eventId)

			const inner = Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`
					INSERT INTO calendar_events (
						id, organization_id, source, provider, provider_booking_id,
						ical_uid, ical_sequence, start_at, end_at, status, title,
						location_type, organizer_email
					) VALUES (
						${eventId}::uuid,
						current_setting('app.current_org_id', true),
						'booking', 'calcom',
						${`booking-${eventId}`},
						${icalUid}, 0,
						now() + interval '7 days',
						now() + interval '7 days 30 minutes',
						'confirmed', 'RLS check',
						'video', 'organizer@taller.cat'
					)
				`
				const rows = yield* sql<{ count: number }>`
					SELECT COUNT(*)::int AS count
					FROM calendar_events
					WHERE id = ${eventId}::uuid
				`
				return rows[0]?.count ?? 0
			})

			const count = await Effect.runPromise(
				Effect.gen(function* () {
					const orgRes = yield* OrgResolution
					// Resolve via organizer-email tier using the fixture inbox.
					const org = yield* orgRes
						.resolveOrgForCalcomWebhook({
							organizer: { email: FIXTURE_INBOX_EMAIL },
						} as never)
						.pipe(Effect.orDie)
					return yield* provideOrg(org)(inner)
				}).pipe(
					Effect.provide(OrgResolution.layer),
					Effect.provide(PgLive),
				) as Effect.Effect<number, never, never>,
			)

			expect(count).toBe(1)
		})
	})
})
