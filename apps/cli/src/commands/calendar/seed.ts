/**
 * Seed the six default `calendar_event_types` rows. Idempotent: a second run
 * updates `provider_event_type_id` + timestamps but never duplicates a slug.
 *
 * Under `CALENDAR_PROVIDER=stub` the BookingProvider layer returns a fake ref
 * without a network call — local dev can run `pnpm cli calendar seed`
 * offline. Under `CALENDAR_PROVIDER=calcom` the same code path POSTs to
 * `https://api.cal.com/v2/event-types` via the live adapter. `internal-block`
 * is always local (`provider='internal'`, `provider_event_type_id=NULL`).
 */

import { Console, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { SqlClient } from 'effect/unstable/sql'

import type {
	CalendarLocationType,
	CalendarProvider,
	UpsertEventTypeInput,
} from '@batuda/calendar'
import { BookingProvider, BookingProviderLive } from '@batuda/calendar'

interface SeedSlug {
	readonly slug: string
	readonly title: string
	readonly durationMinutes: number
	readonly locationKind: CalendarLocationType
	readonly defaultLocationValue: string | null
	/** Local-only slugs skip the BookingProvider call entirely. */
	readonly local: boolean
}

const SEED_SLUGS: ReadonlyArray<SeedSlug> = [
	{
		slug: 'discovery',
		title: 'Discovery call',
		durationMinutes: 30,
		locationKind: 'video',
		defaultLocationValue: null,
		local: false,
	},
	{
		slug: 'demo',
		title: 'Product demo',
		durationMinutes: 45,
		locationKind: 'video',
		defaultLocationValue: null,
		local: false,
	},
	{
		slug: 'kickoff',
		title: 'Project kickoff',
		durationMinutes: 60,
		locationKind: 'video',
		defaultLocationValue: null,
		local: false,
	},
	{
		slug: 'support',
		title: 'Support check-in',
		durationMinutes: 15,
		locationKind: 'video',
		defaultLocationValue: null,
		local: false,
	},
	{
		slug: 'onsite-visit',
		title: 'Onsite visit',
		durationMinutes: 120,
		locationKind: 'address',
		defaultLocationValue: null,
		local: false,
	},
	{
		slug: 'internal-block',
		title: 'Internal focus block',
		durationMinutes: 60,
		locationKind: 'none',
		defaultLocationValue: null,
		local: true,
	},
]

interface UpsertedRow {
	readonly slug: string
	readonly provider: CalendarProvider
	readonly providerEventTypeId: string | null
	readonly status: 'created' | 'updated'
}

const toUpsertInput = (s: SeedSlug): UpsertEventTypeInput => ({
	slug: s.slug,
	title: s.title,
	durationMinutes: s.durationMinutes,
	locationKind: s.locationKind,
	defaultLocationValue: s.defaultLocationValue,
})

export const calendarSeed = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const provider = yield* BookingProvider

	const rows: UpsertedRow[] = []

	for (const seed of SEED_SLUGS) {
		const existing = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types WHERE slug = ${seed.slug} LIMIT 1
		`

		const resolvedProvider: CalendarProvider = seed.local
			? 'internal'
			: 'calcom'
		const ref = seed.local
			? null
			: yield* provider.upsertEventType(toUpsertInput(seed))

		const providerEventTypeId: string | null = ref?.providerEventTypeId ?? null

		if (existing.length === 0) {
			yield* sql`
				INSERT INTO calendar_event_types (
					slug, provider, provider_event_type_id, title, duration_minutes,
					location_kind, default_location_value, active, synced_at
				) VALUES (
					${seed.slug}, ${resolvedProvider}, ${providerEventTypeId}, ${seed.title},
					${seed.durationMinutes}, ${seed.locationKind}, ${seed.defaultLocationValue},
					true, ${seed.local ? null : new Date()}
				)
			`
			rows.push({
				slug: seed.slug,
				provider: resolvedProvider,
				providerEventTypeId,
				status: 'created',
			})
		} else {
			yield* sql`
				UPDATE calendar_event_types
				SET provider = ${resolvedProvider},
				    provider_event_type_id = ${providerEventTypeId},
				    title = ${seed.title},
				    duration_minutes = ${seed.durationMinutes},
				    location_kind = ${seed.locationKind},
				    default_location_value = ${seed.defaultLocationValue},
				    active = true,
				    synced_at = ${seed.local ? null : new Date()},
				    updated_at = now()
				WHERE slug = ${seed.slug}
			`
			rows.push({
				slug: seed.slug,
				provider: resolvedProvider,
				providerEventTypeId,
				status: 'updated',
			})
		}
	}

	yield* Console.log('')
	yield* Console.log('Calendar event types:')
	for (const row of rows) {
		const id = row.providerEventTypeId ?? '—'
		yield* Console.log(
			`  ${row.status === 'created' ? '+' : '~'} ${row.slug.padEnd(16)} provider=${row.provider.padEnd(9)} id=${id}`,
		)
	}
	yield* Console.log('')
}).pipe(
	Effect.provide(
		BookingProviderLive.pipe(Layer.provide(FetchHttpClient.layer)),
	),
)
