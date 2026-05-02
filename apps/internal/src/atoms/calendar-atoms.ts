import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Calendar atom registry (§6 of the calendar plan).
 *
 * Events are fetched once for a wide window on first paint (current
 * month ± a fortnight on each side). Schedule-X owns the visible-range
 * navigation in-memory; we refetch when the user jumps more than a
 * month forward/backward via a `calendarRangeAtom` held on the page,
 * not by re-keying the module-level atom (that would refetch on every
 * view switch).
 */
export const calendarEventTypesAtom = BatudaApiAtom.query(
	'calendar',
	'listEventTypes',
	{ query: { active: 'true' } },
)

/**
 * Upcoming + recent events. `from` and `to` are absent on purpose — the
 * server returns a sensible default window (next 60d + past 30d) so
 * first paint always has context. A dedicated page-level atom re-runs
 * the query with explicit range when the user navigates outside it.
 */
export const calendarEventsAtom = BatudaApiAtom.query(
	'calendar',
	'listEvents',
	{
		query: { limit: 500 },
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
