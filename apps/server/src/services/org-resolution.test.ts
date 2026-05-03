// PgLive reads DATABASE_URL via Config at layer-build time. Default to
// the docker-compose service so the suite runs without a loaded .env.
process.env['DATABASE_URL'] ??=
	'postgresql://batuda:batuda@localhost:5433/batuda'

import { randomUUID } from 'node:crypto'

import { Cause, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client.js'
import { OrgResolution, type UnknownOrg } from './org-resolution.js'

// Integration test for the two-tier resolver. Real Postgres + real
// SqlClient. Uses raw `pg`-via-SqlClient under app_service for setup
// (the resolver itself runs as app_service inside its own tx); each
// test cleans up the rows it inserts.
//
// Requires: `pnpm cli services up` so Postgres is reachable on
// $DATABASE_URL, and the seeded `taller` + `restaurant` orgs from
// `pnpm cli db reset` so the JOIN to `organization` finds rows.

const TALLER = 'taller'
const RESTAURANT = 'restaurant'

const provideTestLayer = OrgResolution.layer.pipe(Layer.provide(PgLive))

interface OrgIds {
	taller: string
	restaurant: string
}

const insertEvent = (args: {
	id: string
	orgId: string
	icalUid: string
	source: 'booking' | 'email' | 'internal'
	provider: 'calcom' | 'email' | 'google'
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SET LOCAL ROLE app_service`
		const providerBookingId =
			args.source === 'booking' ? `booking-${args.id}` : null
		yield* sql`
			INSERT INTO calendar_events (
				id, organization_id, source, provider, provider_booking_id,
				ical_uid, ical_sequence, start_at, end_at, status, title,
				location_type, organizer_email
			) VALUES (
				${args.id}::uuid, ${args.orgId}, ${args.source}, ${args.provider},
				${providerBookingId},
				${args.icalUid}, 0,
				now() + interval '7 days',
				now() + interval '7 days 30 minutes',
				'confirmed', 'Test event',
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

const insertInbox = (args: {
	id: string
	orgId: string
	email: string
	active: boolean
	createdAt?: Date
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SET LOCAL ROLE app_service`
		const placeholder = new Uint8Array([0])
		const created = args.createdAt
		if (created !== undefined) {
			yield* sql`
				INSERT INTO inboxes (
					id, organization_id, email, purpose, owner_user_id,
					imap_host, imap_port, imap_security,
					smtp_host, smtp_port, smtp_security,
					username, password_ciphertext, password_nonce, password_tag,
					active, created_at
				) VALUES (
					${args.id}::uuid, ${args.orgId}, ${args.email}, 'human', 'org-resolution-test-user',
					'imap.test', 993, 'tls',
					'smtp.test', 587, 'starttls',
					${args.email}, ${placeholder}, ${placeholder}, ${placeholder},
					${args.active}, ${created}
				)
			`
			return
		}
		yield* sql`
			INSERT INTO inboxes (
				id, organization_id, email, purpose, owner_user_id,
				imap_host, imap_port, imap_security,
				smtp_host, smtp_port, smtp_security,
				username, password_ciphertext, password_nonce, password_tag,
				active
			) VALUES (
				${args.id}::uuid, ${args.orgId}, ${args.email}, 'human', 'org-resolution-test-user',
				'imap.test', 993, 'tls',
				'smtp.test', 587, 'starttls',
				${args.email}, ${placeholder}, ${placeholder}, ${placeholder},
				${args.active}
			)
		`
	})

const cleanupInbox = (id: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SET LOCAL ROLE app_service`
		yield* sql`DELETE FROM inboxes WHERE id = ${id}::uuid`
	})

const fetchOrgIds = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql<{ slug: string; id: string }>`
		SELECT slug, id FROM "organization" WHERE slug IN (${TALLER}, ${RESTAURANT})
	`
	const tallerId = rows.find(r => r.slug === TALLER)?.id
	const restaurantId = rows.find(r => r.slug === RESTAURANT)?.id
	if (!tallerId || !restaurantId) {
		throw new Error(
			`taller / restaurant orgs missing — run 'pnpm cli db reset' before this test`,
		)
	}
	return { taller: tallerId, restaurant: restaurantId }
})

describe('resolveOrgForCalcomWebhook', () => {
	let orgIds: OrgIds
	const seededRows: Array<{ kind: 'event' | 'inbox'; id: string }> = []

	beforeAll(async () => {
		orgIds = await Effect.runPromise(
			fetchOrgIds.pipe(Effect.provide(PgLive)) as Effect.Effect<
				OrgIds,
				never,
				never
			>,
		)
	})

	afterAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				for (const r of seededRows) {
					if (r.kind === 'event') yield* cleanupEvent(r.id)
					else yield* cleanupInbox(r.id)
				}
			}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
		)
	})

	describe('when the iCalUID matches an existing cal.com calendar_event', () => {
		it("should return the event's org regardless of organizer email", async () => {
			// GIVEN a calendar_events row with provider=calcom + source=booking in taller
			//       AND an inboxes row in restaurant for some-organizer@example.com
			// WHEN the resolver is called with that iCalUID + an organizer email registered in restaurant
			// THEN the iCalUID match wins (taller is returned)
			// [org-resolution.ts — tier-1 SELECT, source/provider filter]
			const eventId = randomUUID()
			const inboxId = randomUUID()
			const icalUid = `t1-${eventId}`
			const email = `t1-${eventId}@example.com`
			seededRows.push({ kind: 'event', id: eventId })
			seededRows.push({ kind: 'inbox', id: inboxId })

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* insertEvent({
						id: eventId,
						orgId: orgIds.taller,
						icalUid,
						source: 'booking',
						provider: 'calcom',
					})
					yield* insertInbox({
						id: inboxId,
						orgId: orgIds.restaurant,
						email,
						active: true,
					})
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const orgRes = yield* OrgResolution
					return yield* orgRes.resolveOrgForCalcomWebhook({
						iCalUID: icalUid,
						organizer: { email },
					} as never)
				}).pipe(Effect.provide(provideTestLayer)) as Effect.Effect<
					{ id: string; slug: string; name: string },
					never,
					never
				>,
			)

			expect(result.id).toBe(orgIds.taller)
			expect(result.slug).toBe(TALLER)
		})
	})

	describe('when no iCalUID row exists and the organizer email matches an active inbox', () => {
		it("should return the inbox owner's org (case-insensitive on email)", async () => {
			// GIVEN no calendar_events row
			//       AND an inboxes row in taller for case-test@example.com (active=true)
			// WHEN the resolver is called with mixed-case organizer email
			// THEN lower(email) = lower($1) matches and resolves to taller
			// [org-resolution.ts — tier-2 SELECT]
			const inboxId = randomUUID()
			const lowerEmail = `case-test-${inboxId}@example.com`
			seededRows.push({ kind: 'inbox', id: inboxId })

			await Effect.runPromise(
				insertInbox({
					id: inboxId,
					orgId: orgIds.taller,
					email: lowerEmail,
					active: true,
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const orgRes = yield* OrgResolution
					return yield* orgRes.resolveOrgForCalcomWebhook({
						organizer: { email: lowerEmail.toUpperCase() },
					} as never)
				}).pipe(Effect.provide(provideTestLayer)) as Effect.Effect<
					{ id: string; slug: string; name: string },
					never,
					never
				>,
			)

			expect(result.id).toBe(orgIds.taller)
		})
	})

	describe('when iCalUID is empty and organizer email is unknown', () => {
		it('should fail with UnknownOrg carrying both lookup keys', async () => {
			// GIVEN a payload with no iCalUID and an unregistered organizer email
			// WHEN the resolver runs
			// THEN it Effect.fails with UnknownOrg({icalUid, organizerEmail})
			// [org-resolution.ts — fall-through case]
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					const orgRes = yield* OrgResolution
					return yield* orgRes.resolveOrgForCalcomWebhook({
						organizer: { email: `nobody-${randomUUID()}@nowhere.invalid` },
					} as never)
				}).pipe(Effect.provide(provideTestLayer)) as Effect.Effect<
					unknown,
					UnknownOrg,
					never
				>,
			)

			expect(exit._tag).toBe('Failure')
			if (exit._tag === 'Failure') {
				const failure = Cause.findErrorOption(exit.cause)
				expect(failure._tag).toBe('Some')
				if (failure._tag === 'Some') {
					expect((failure.value as UnknownOrg)._tag).toBe('UnknownOrg')
				}
			}
		})
	})

	describe('when an email-sourced ICS row in another org shares the same iCalUID', () => {
		it('should NOT return that org (filter source=booking AND provider=calcom)', async () => {
			// GIVEN an email-sourced calendar_events row with iCalUID X in taller
			//       AND a cal.com booking with iCalUID X in restaurant
			// WHEN the resolver is called for iCalUID X
			// THEN restaurant is returned (not taller — filter excludes the email row)
			// [org-resolution.ts — tier-1 WHERE clause filters source/provider]
			const emailEventId = randomUUID()
			const calcomEventId = randomUUID()
			const sharedUid = `shared-${calcomEventId}`
			seededRows.push({ kind: 'event', id: emailEventId })
			seededRows.push({ kind: 'event', id: calcomEventId })

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* insertEvent({
						id: emailEventId,
						orgId: orgIds.taller,
						icalUid: sharedUid,
						source: 'email',
						provider: 'email',
					})
					yield* insertEvent({
						id: calcomEventId,
						orgId: orgIds.restaurant,
						icalUid: sharedUid,
						source: 'booking',
						provider: 'calcom',
					})
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const orgRes = yield* OrgResolution
					return yield* orgRes.resolveOrgForCalcomWebhook({
						iCalUID: sharedUid,
					} as never)
				}).pipe(Effect.provide(provideTestLayer)) as Effect.Effect<
					{ id: string; slug: string; name: string },
					never,
					never
				>,
			)

			expect(result.id).toBe(orgIds.restaurant)
		})
	})

	describe('when two inboxes across two orgs share the same email', () => {
		it('should return the longest-standing org (ORDER BY created_at ASC LIMIT 1)', async () => {
			// GIVEN inboxes(org=taller, email=x, created_at=2025-12-01)
			//       AND inboxes(org=restaurant, email=x, created_at=2026-04-01)
			// WHEN the resolver is called with email=x and no iCalUID
			// THEN taller is returned (oldest)
			// [org-resolution.ts — ambiguity tie-break]
			const olderId = randomUUID()
			const newerId = randomUUID()
			const sharedEmail = `dual-${olderId}@example.com`
			seededRows.push({ kind: 'inbox', id: olderId })
			seededRows.push({ kind: 'inbox', id: newerId })

			await Effect.runPromise(
				Effect.gen(function* () {
					yield* insertInbox({
						id: olderId,
						orgId: orgIds.taller,
						email: sharedEmail,
						active: true,
						createdAt: new Date('2025-12-01T00:00:00Z'),
					})
					yield* insertInbox({
						id: newerId,
						orgId: orgIds.restaurant,
						email: sharedEmail,
						active: true,
						createdAt: new Date('2026-04-01T00:00:00Z'),
					})
				}).pipe(Effect.provide(PgLive)) as Effect.Effect<void, never, never>,
			)

			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const orgRes = yield* OrgResolution
					return yield* orgRes.resolveOrgForCalcomWebhook({
						organizer: { email: sharedEmail },
					} as never)
				}).pipe(Effect.provide(provideTestLayer)) as Effect.Effect<
					{ id: string; slug: string; name: string },
					never,
					never
				>,
			)

			expect(result.id).toBe(orgIds.taller)
		})
	})
})
