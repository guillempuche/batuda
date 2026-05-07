import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'

import type { TaskRow } from './crm'
import { TEST_USER } from './fixtures'
import { normalizeRows, type SeedCtx } from './shared'

export const seedCalendar = (
	{ sql, tallerOrgId, stamp }: SeedCtx,
	companyMap: Map<string, string>,
	insertedTasks: ReadonlyArray<TaskRow>,
) =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Seeding calendar...')
		const calendarEventTypeSeeds = [
			{
				slug: 'discovery',
				provider: 'calcom',
				title: 'Discovery call',
				durationMinutes: 30,
				locationKind: 'video',
			},
			{
				slug: 'demo',
				provider: 'calcom',
				title: 'Product demo',
				durationMinutes: 45,
				locationKind: 'video',
			},
			{
				slug: 'kickoff',
				provider: 'calcom',
				title: 'Project kickoff',
				durationMinutes: 60,
				locationKind: 'video',
			},
			{
				slug: 'support',
				provider: 'calcom',
				title: 'Support check-in',
				durationMinutes: 15,
				locationKind: 'video',
			},
			{
				slug: 'onsite-visit',
				provider: 'calcom',
				title: 'Onsite visit',
				durationMinutes: 120,
				locationKind: 'address',
			},
			{
				slug: 'internal-block',
				provider: 'internal',
				title: 'Internal focus block',
				durationMinutes: 60,
				locationKind: 'none',
			},
		] as const
		for (const et of calendarEventTypeSeeds) {
			yield* sql`
				INSERT INTO calendar_event_types (
					organization_id, slug, provider, provider_event_type_id, title,
					duration_minutes, location_kind, default_location_value, active
				) VALUES (
					${tallerOrgId}, ${et.slug}, ${et.provider}, NULL, ${et.title},
					${et.durationMinutes}, ${et.locationKind}, NULL, true
				) ON CONFLICT (organization_id, slug) DO UPDATE SET
					title = EXCLUDED.title,
					duration_minutes = EXCLUDED.duration_minutes,
					location_kind = EXCLUDED.location_kind,
					updated_at = now()
			`
		}
		const [discoveryType] = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types
			WHERE organization_id = ${tallerOrgId} AND slug = 'discovery'
			LIMIT 1
		`
		const [internalType] = yield* sql<{ id: string }>`
			SELECT id FROM calendar_event_types
			WHERE organization_id = ${tallerOrgId} AND slug = 'internal-block'
			LIMIT 1
		`
		const calDay = 24 * 60 * 60 * 1000
		const now = Date.now()
		const calcomCompany = companyMap.get('cal-pep-fonda')
		const ferrosCompany = companyMap.get('ferros-baix-llobregat')
		const hostalCompany = companyMap.get('hostal-pirineu')
		const tancamentsCompany = companyMap.get('tancaments-garraf')
		const calendarEventSeeds = [
			{
				source: 'email',
				provider: 'email',
				providerBookingId: null,
				icalUid: 'zoom-seed-1@calendar.batuda',
				icalSequence: 0,
				eventTypeId: null,
				startAt: new Date(now + 3 * calDay),
				endAt: new Date(now + 3 * calDay + 30 * 60 * 1000),
				status: 'confirmed',
				title: 'Zoom sync with Cal Pep',
				locationType: 'video',
				locationValue: 'https://acme.zoom.us/j/1234567890',
				videoCallUrl: 'https://acme.zoom.us/j/1234567890',
				organizerEmail: 'organizer@externo.com',
				companyId: calcomCompany ?? null,
				contactId: null,
				interactionId: null,
				metadata: null,
				rawIcs: null,
			},
			{
				source: 'email',
				provider: 'email',
				providerBookingId: null,
				icalUid: 'teams-seed-1@calendar.batuda',
				icalSequence: 0,
				eventTypeId: null,
				startAt: new Date(now + 5 * calDay),
				endAt: new Date(now + 5 * calDay + 60 * 60 * 1000),
				status: 'confirmed',
				title: 'Teams review — Ferros BL',
				locationType: 'video',
				locationValue: 'Microsoft Teams Meeting',
				videoCallUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
				organizerEmail: 'pm@ferros-bl.cat',
				companyId: ferrosCompany ?? null,
				contactId: null,
				interactionId: null,
				metadata: null,
				rawIcs: null,
			},
			{
				source: 'email',
				provider: 'email',
				providerBookingId: null,
				icalUid: 'meet-seed-1@calendar.batuda',
				icalSequence: 0,
				eventTypeId: null,
				startAt: new Date(now + 7 * calDay),
				endAt: new Date(now + 7 * calDay + 30 * 60 * 1000),
				status: 'confirmed',
				title: 'Meet — Hostal Pirineu booking flow',
				locationType: 'video',
				locationValue: 'https://meet.google.com/abc-defg-hij',
				videoCallUrl: 'https://meet.google.com/abc-defg-hij',
				organizerEmail: 'owner@hostal-pirineu.cat',
				companyId: hostalCompany ?? null,
				contactId: null,
				interactionId: null,
				metadata: null,
				rawIcs: null,
			},
			{
				source: 'booking',
				provider: 'calcom',
				providerBookingId: 'seed-cal-booking-1',
				icalUid: 'seed-cal-1@calendar.batuda',
				icalSequence: 0,
				eventTypeId: discoveryType?.id ?? null,
				startAt: new Date(now + 2 * calDay),
				endAt: new Date(now + 2 * calDay + 30 * 60 * 1000),
				status: 'confirmed',
				title: 'Discovery call — Tancaments Garraf',
				locationType: 'video',
				locationValue: null,
				videoCallUrl: 'https://cal.com/video/seed-cal-booking-1',
				organizerEmail: TEST_USER.email,
				companyId: tancamentsCompany ?? null,
				contactId: null,
				interactionId: null,
				metadata: { source: 'batuda' },
				rawIcs: null,
			},
			{
				source: 'booking',
				provider: 'calcom',
				providerBookingId: 'seed-cal-booking-2',
				icalUid: 'seed-cal-2@calendar.batuda',
				icalSequence: 1,
				eventTypeId: discoveryType?.id ?? null,
				startAt: new Date(now + 4 * calDay),
				endAt: new Date(now + 4 * calDay + 30 * 60 * 1000),
				status: 'cancelled',
				title: 'Discovery call — Ferros BL (cancelled)',
				locationType: 'video',
				locationValue: null,
				videoCallUrl: null,
				organizerEmail: TEST_USER.email,
				companyId: ferrosCompany ?? null,
				contactId: null,
				interactionId: null,
				metadata: { cancelledReason: 'prospect_rescheduled' },
				rawIcs: null,
			},
			{
				source: 'internal',
				provider: 'internal',
				providerBookingId: null,
				icalUid: `internal-seed-1-${randomUUID()}@calendar.batuda`,
				icalSequence: 0,
				eventTypeId: internalType?.id ?? null,
				startAt: new Date(now + 1 * calDay),
				endAt: new Date(now + 1 * calDay + 90 * 60 * 1000),
				status: 'confirmed',
				title: 'Deep work — proposal draft',
				locationType: 'none',
				locationValue: null,
				videoCallUrl: null,
				organizerEmail: TEST_USER.email,
				companyId: null,
				contactId: null,
				interactionId: null,
				metadata: null,
				rawIcs: null,
			},
		]
		const insertedCalendarEvents = yield* sql<{
			id: string
			source: string
			title: string
		}>`
			INSERT INTO calendar_events ${sql.insert(normalizeRows(stamp(calendarEventSeeds)))}
			RETURNING id, source, title
		`
		const attendeeRows = insertedCalendarEvents
			.filter(e => e.source !== 'internal')
			.flatMap(e => [
				{
					eventId: e.id,
					email: TEST_USER.email,
					name: TEST_USER.name,
					contactId: null,
					companyId: null,
					rsvp: 'accepted',
					isOrganizer: e.source === 'booking',
				},
				{
					eventId: e.id,
					email:
						e.source === 'email'
							? 'organizer@externo.com'
							: 'prospect@example.com',
					name: null,
					contactId: null,
					companyId: null,
					rsvp: e.source === 'email' ? 'needs-action' : 'accepted',
					isOrganizer: e.source === 'email',
				},
			])
		if (attendeeRows.length > 0) {
			yield* sql`
				INSERT INTO calendar_event_attendees ${sql.insert(normalizeRows(stamp(attendeeRows)))}
			`
		}
		const taskEventRows = insertedTasks.slice(0, 3).map(t => ({
			taskId: t.id,
			actorId: null,
			actorKind: 'user',
			change: { kind: 'created', snapshot: { title: t.title } },
		}))
		if (taskEventRows.length > 0) {
			yield* sql`INSERT INTO task_events ${sql.insert(normalizeRows(stamp(taskEventRows)))}`
		}
		yield* Effect.logInfo(
			`  ${insertedCalendarEvents.length} events, ${attendeeRows.length} attendees, ${taskEventRows.length} task events`,
		)
	})
