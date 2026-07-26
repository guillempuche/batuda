import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Calendar atom registry.
 *
 * Moving between weeks and months is handled in the browser, so the whole
 * set is fetched once rather than re-fetched on every view switch.
 */

/**
 * Every event the cap allows, oldest first. No date range is asked for, so
 * this is the earliest events on file rather than a window around today —
 * once an organisation has more than the cap, the newest meetings fall off
 * the end.
 */
export const calendarEventsAtom = BatudaApiAtom.query(
	'calendar',
	'listEvents',
	{
		query: { limit: 500 },
		serializationKey: 'calendar:events',
	},
)

const eventsByCompanyCache = new Map<
	string,
	ReturnType<typeof makeEventsByCompanyAtom>
>()

function makeEventsByCompanyAtom(args: {
	companyId: string
	from?: string
	limit: number
}) {
	const query: Record<string, string | number> = {
		companyId: args.companyId,
		limit: args.limit,
	}
	if (args.from !== undefined) query['from'] = args.from
	return BatudaApiAtom.query('calendar', 'listEvents', { query })
}

export function calendarEventsByCompanyAtom(args: {
	companyId: string
	from?: string
	limit: number
}) {
	const key = `${args.companyId}|${args.from ?? ''}|${args.limit}`
	const existing = eventsByCompanyCache.get(key)
	if (existing !== undefined) return existing
	const atom = makeEventsByCompanyAtom(args)
	eventsByCompanyCache.set(key, atom)
	return atom
}

export const createInternalEventAtom = BatudaApiAtom.mutation(
	'calendar',
	'createInternalEvent',
)

/**
 * RSVP for an email-sourced calendar event. Accepts `{ rsvp, comment? }`
 * via payload and `{ id }` via path params. The server hands the work
 * to `CalendarService.respondToRsvp`, which builds a METHOD=REPLY ICS
 * for email-sourced rows or calls `BookingProvider.respondToRsvp` for
 * bookings. The drawer buttons are the first UI caller.
 */
export const rsvpEventAtom = BatudaApiAtom.mutation('calendar', 'rsvpEvent')

const eventDetailCache = new Map<
	string,
	ReturnType<typeof makeEventDetailAtom>
>()
function makeEventDetailAtom(eventId: string) {
	return BatudaApiAtom.query('calendar', 'getEvent', {
		params: { id: eventId },
	})
}
export function calendarEventDetailAtomFor(eventId: string) {
	const existing = eventDetailCache.get(eventId)
	if (existing !== undefined) return existing
	const atom = makeEventDetailAtom(eventId)
	eventDetailCache.set(eventId, atom)
	return atom
}
