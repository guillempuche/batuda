/**
 * Post a signed cal.com-shaped webhook envelope into the local server without
 * touching cal.com — lets us exercise `/webhooks/calcom` (HMAC verify +
 * dispatch + upsert) end-to-end offline. The HMAC uses the same
 * `CALENDAR_WEBHOOK_SECRET` the real handler checks.
 */

import { createHmac, randomUUID } from 'node:crypto'

import { Config, Console, Effect, Redacted } from 'effect'
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
} from 'effect/unstable/http'

export const SIMULATE_TRIGGERS = [
	'BOOKING_CREATED',
	'BOOKING_RESCHEDULED',
	'BOOKING_CANCELLED',
	'BOOKING_REQUESTED',
	'BOOKING_REJECTED',
	'MEETING_ENDED',
] as const
export type SimulateTrigger = (typeof SIMULATE_TRIGGERS)[number]

interface SimulateArgs {
	readonly trigger: SimulateTrigger
	readonly url: string
	readonly icalUid: string | null
}

interface EnvelopePayload {
	readonly iCalUID: string
	readonly iCalSequence: number
	readonly bookingId: number
	readonly uid: string
	readonly eventTypeId: number
	readonly title: string
	readonly startTime: string
	readonly endTime: string
	readonly organizer: { readonly email: string; readonly name: string }
	readonly attendees: ReadonlyArray<{
		readonly email: string
		readonly name: string
	}>
	readonly location: string
	readonly metadata: Record<string, unknown>
	readonly rescheduleStartTime?: string
}

const oneHour = 60 * 60 * 1000

const buildPayload = (
	trigger: SimulateTrigger,
	icalUid: string,
): EnvelopePayload => {
	const start = new Date(Date.now() + 24 * oneHour)
	const end = new Date(start.getTime() + oneHour)
	const base: EnvelopePayload = {
		iCalUID: icalUid,
		iCalSequence: trigger === 'BOOKING_RESCHEDULED' ? 1 : 0,
		bookingId: 10001,
		uid: 'sim-booking-uid',
		eventTypeId: 12345,
		title: `[simulate] ${trigger.toLowerCase()}`,
		startTime: start.toISOString(),
		endTime: end.toISOString(),
		organizer: {
			email: 'dev@batuda.co',
			name: 'Dev Batuda',
		},
		attendees: [{ email: 'alice@example.com', name: 'Alice Example' }],
		location: 'integrations:daily',
		metadata: { source: 'cli-simulate' },
	}
	if (trigger === 'BOOKING_RESCHEDULED') {
		const previous = new Date(start.getTime() - 2 * oneHour)
		return { ...base, rescheduleStartTime: previous.toISOString() }
	}
	return base
}

const buildEnvelope = (trigger: SimulateTrigger, icalUid: string) => ({
	triggerEvent: trigger,
	createdAt: new Date().toISOString(),
	payload: buildPayload(trigger, icalUid),
})

export const calendarSimulateWebhook = (args: SimulateArgs) =>
	Effect.gen(function* () {
		const secret = yield* Config.redacted('CALENDAR_WEBHOOK_SECRET')
		const icalUid = args.icalUid ?? `sim-${randomUUID()}@calendar.batuda`
		const envelope = buildEnvelope(args.trigger, icalUid)
		const body = JSON.stringify(envelope)
		const signature = createHmac('sha256', Redacted.value(secret))
			.update(body)
			.digest('hex')

		const client = yield* HttpClient.HttpClient
		const response = yield* client.execute(
			HttpClientRequest.post(args.url).pipe(
				HttpClientRequest.setHeaders({
					'content-type': 'application/json',
					'x-cal-signature-256': signature,
				}),
				HttpClientRequest.bodyText(body, 'application/json'),
			),
		)
		const text = yield* response.text

		yield* Console.log(`POST ${args.url}`)
		yield* Console.log(`  trigger:     ${args.trigger}`)
		yield* Console.log(`  ical_uid:    ${icalUid}`)
		yield* Console.log(`  status:      ${response.status}`)
		yield* Console.log(`  body:        ${text}`)
	}).pipe(Effect.provide(FetchHttpClient.layer))
