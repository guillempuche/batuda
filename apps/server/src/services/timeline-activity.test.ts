import { describe, expect, it } from 'vitest'

import {
	DocumentCreated,
	denormColumnFor,
	EmailReceived,
	EmailSent,
	InteractionLogged,
	MeetingCancelled,
	MeetingRescheduled,
	MeetingRsvp,
	MeetingScheduled,
	mapEventToInteraction,
	needsNextMeetingRecompute,
	ProposalEvent,
	ResearchRunCompleted,
	SystemEvent,
	TaskCompleted,
	TaskCreated,
	TaskUpdated,
} from './timeline-activity'

const at = new Date('2026-04-18T10:00:00Z')
const pastStart = new Date('2026-04-10T09:00:00Z')
const futureStart = new Date('2026-05-01T15:00:00Z')
const now = new Date('2026-04-18T10:00:00Z')

const emailSent = () =>
	new EmailSent({
		emailMessageId: 'em-1',
		companyId: 'co-1',
		contactId: 'ct-1',
		subject: 'Hello',
		summary: null,
		actorUserId: null,
		occurredAt: at,
	})

const emailReceived = () =>
	new EmailReceived({
		emailMessageId: 'em-2',
		companyId: 'co-1',
		contactId: 'ct-1',
		subject: 'Re: Hello',
		summary: null,
		occurredAt: at,
		classification: 'normal',
	})

const interactionLogged = (overrides: Partial<InteractionLogged> = {}) =>
	new InteractionLogged({
		companyId: 'co-1',
		contactId: 'ct-1',
		channel: 'call',
		direction: 'outbound',
		type: 'call',
		subject: null,
		summary: 'Call summary',
		outcome: null,
		nextAction: null,
		nextActionAt: null,
		durationMin: null,
		occurredAt: at,
		actorUserId: null,
		attachInteractionId: null,
		...overrides,
	})

describe('denormColumnFor', () => {
	it('maps email events to last_email_at', () => {
		// GIVEN an EmailSent and an EmailReceived
		// WHEN denormColumnFor runs
		// THEN both select the email cadence column
		expect(denormColumnFor(emailSent())).toBe('last_email_at')
		expect(denormColumnFor(emailReceived())).toBe('last_email_at')
	})

	it('maps phone and call channels to last_call_at', () => {
		// GIVEN InteractionLogged with channel 'phone' or 'call'
		// AND recordings.ts writes channel='call' while the interactions schema docs 'phone'
		// WHEN denormColumnFor runs
		// THEN both channels resolve to the call cadence column
		expect(denormColumnFor(interactionLogged({ channel: 'phone' }))).toBe(
			'last_call_at',
		)
		expect(denormColumnFor(interactionLogged({ channel: 'call' }))).toBe(
			'last_call_at',
		)
	})

	it('maps visit and event channels to last_meeting_at', () => {
		// GIVEN InteractionLogged with channel 'visit' or 'event'
		// WHEN denormColumnFor runs
		// THEN both resolve to the meeting cadence column
		expect(denormColumnFor(interactionLogged({ channel: 'visit' }))).toBe(
			'last_meeting_at',
		)
		expect(denormColumnFor(interactionLogged({ channel: 'event' }))).toBe(
			'last_meeting_at',
		)
	})

	it('returns null for DM-style channels without a cadence column', () => {
		// GIVEN InteractionLogged on linkedin, instagram, or whatsapp
		// WHEN denormColumnFor runs
		// THEN there is no cadence column to bump
		expect(denormColumnFor(interactionLogged({ channel: 'linkedin' }))).toBe(
			null,
		)
		expect(denormColumnFor(interactionLogged({ channel: 'instagram' }))).toBe(
			null,
		)
		expect(denormColumnFor(interactionLogged({ channel: 'whatsapp' }))).toBe(
			null,
		)
	})

	it('returns null for non-touchpoint events', () => {
		// GIVEN DocumentCreated, ProposalEvent, ResearchRunCompleted, SystemEvent
		// WHEN denormColumnFor runs
		// THEN none of them bump a cadence column
		expect(
			denormColumnFor(
				new DocumentCreated({
					documentId: 'd-1',
					companyId: 'co-1',
					contactId: null,
					title: 'Brief',
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(null)
		expect(
			denormColumnFor(
				new ProposalEvent({
					proposalId: 'p-1',
					kind: 'sent',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(null)
		expect(
			denormColumnFor(
				new ResearchRunCompleted({
					researchRunId: 'r-1',
					companyId: 'co-1',
					summary: 'done',
					status: 'succeeded',
					occurredAt: at,
				}),
			),
		).toBe(null)
		expect(
			denormColumnFor(
				new SystemEvent({
					entityType: 'system',
					entityId: 's-1',
					companyId: null,
					contactId: null,
					summary: 'boot',
					payload: {},
					occurredAt: at,
				}),
			),
		).toBe(null)
	})

	it('bumps last_meeting_at only when a scheduled meeting is in the past', () => {
		// GIVEN a MeetingScheduled whose startAt is BEFORE now (backfilled)
		// WHEN denormColumnFor runs with that `now`
		// THEN it selects last_meeting_at for a GREATEST bump
		expect(
			denormColumnFor(
				new MeetingScheduled({
					calendarEventId: 'ce-1',
					companyId: 'co-1',
					contactId: null,
					source: 'email',
					title: 'Past kickoff',
					startAt: pastStart,
					endAt: new Date('2026-04-10T10:00:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
				now,
			),
		).toBe('last_meeting_at')

		// GIVEN a MeetingScheduled whose startAt is AFTER now
		// WHEN denormColumnFor runs with that `now`
		// THEN no cadence column is bumped (only next_calendar_event_at via recompute)
		expect(
			denormColumnFor(
				new MeetingScheduled({
					calendarEventId: 'ce-2',
					companyId: 'co-1',
					contactId: null,
					source: 'booking',
					title: 'Future demo',
					startAt: futureStart,
					endAt: new Date('2026-05-01T15:30:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
				now,
			),
		).toBe(null)
	})

	it('treats reschedules symmetrically — past new-start bumps, future does not', () => {
		// GIVEN a MeetingRescheduled whose NEW startAt is in the past
		// WHEN denormColumnFor runs
		// THEN last_meeting_at gets bumped (this path feeds the GREATEST path
		// even if the reschedule also triggers the next_calendar_event_at recompute)
		expect(
			denormColumnFor(
				new MeetingRescheduled({
					calendarEventId: 'ce-3',
					companyId: 'co-1',
					contactId: null,
					previousStartAt: new Date('2026-04-05T09:00:00Z'),
					startAt: pastStart,
					endAt: new Date('2026-04-10T10:00:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
				now,
			),
		).toBe('last_meeting_at')

		expect(
			denormColumnFor(
				new MeetingRescheduled({
					calendarEventId: 'ce-4',
					companyId: 'co-1',
					contactId: null,
					previousStartAt: futureStart,
					startAt: new Date('2026-06-01T09:00:00Z'),
					endAt: new Date('2026-06-01T10:00:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
				now,
			),
		).toBe(null)
	})

	it('returns null for MeetingCancelled, MeetingRsvp, and all task events', () => {
		// GIVEN a MeetingCancelled — cancellation is handled by the recompute path,
		// not by a GREATEST bump, so the column selector is null here
		expect(
			denormColumnFor(
				new MeetingCancelled({
					calendarEventId: 'ce-5',
					companyId: 'co-1',
					contactId: null,
					cancelledStartAt: futureStart,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(null)

		// GIVEN an RSVP — attendee state change cannot shift any meeting time
		expect(
			denormColumnFor(
				new MeetingRsvp({
					calendarEventId: 'ce-6',
					attendeeEmail: 'alice@x.com',
					rsvp: 'accepted',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(null)

		// GIVEN a task event — tasks never bump cadence columns
		expect(
			denormColumnFor(
				new TaskCreated({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					title: 'Call Acme',
					taskType: 'call',
					actorUserId: null,
					actorKind: 'user',
					occurredAt: at,
				}),
			),
		).toBe(null)
		expect(
			denormColumnFor(
				new TaskUpdated({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					change: { title: ['old', 'new'] },
					actorUserId: null,
					actorKind: 'agent',
					occurredAt: at,
				}),
			),
		).toBe(null)
		expect(
			denormColumnFor(
				new TaskCompleted({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					actorKind: 'user',
					occurredAt: at,
				}),
			),
		).toBe(null)
	})
})

describe('needsNextMeetingRecompute', () => {
	it('returns true for meeting schedule, reschedule, and cancel — each can shift next_calendar_event_at', () => {
		// GIVEN the three meeting-lifecycle events that can change the next-upcoming window
		// WHEN needsNextMeetingRecompute runs
		// THEN each returns true (rescheduling earlier or cancelling can DECREASE the value,
		// which is why a GREATEST bump is not sufficient — we must recompute from calendar_events)
		expect(
			needsNextMeetingRecompute(
				new MeetingScheduled({
					calendarEventId: 'ce-1',
					companyId: 'co-1',
					contactId: null,
					source: 'booking',
					title: 'Demo',
					startAt: futureStart,
					endAt: new Date('2026-05-01T15:30:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(true)
		expect(
			needsNextMeetingRecompute(
				new MeetingRescheduled({
					calendarEventId: 'ce-2',
					companyId: 'co-1',
					contactId: null,
					previousStartAt: futureStart,
					startAt: new Date('2026-06-01T09:00:00Z'),
					endAt: new Date('2026-06-01T10:00:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(true)
		expect(
			needsNextMeetingRecompute(
				new MeetingCancelled({
					calendarEventId: 'ce-3',
					companyId: 'co-1',
					contactId: null,
					cancelledStartAt: futureStart,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(true)
	})

	it('returns false for non-meeting-lifecycle events', () => {
		// GIVEN events that leave the calendar_events set untouched
		// WHEN needsNextMeetingRecompute runs
		// THEN no recompute is needed — the SELECT MIN(start_at) read is skipped
		expect(needsNextMeetingRecompute(emailSent())).toBe(false)
		expect(
			needsNextMeetingRecompute(
				new MeetingRsvp({
					calendarEventId: 'ce-x',
					attendeeEmail: 'alice@x.com',
					rsvp: 'accepted',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBe(false)
		expect(
			needsNextMeetingRecompute(
				new TaskCreated({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					title: 'Call Acme',
					taskType: 'call',
					actorUserId: null,
					actorKind: 'user',
					occurredAt: at,
				}),
			),
		).toBe(false)
	})
})

describe('mapEventToInteraction', () => {
	it('builds an outbound email row for EmailSent', () => {
		// GIVEN an EmailSent event
		// WHEN mapEventToInteraction runs
		// THEN it returns channel=email, direction=outbound, type=email
		// AND metadata carries the email_message id for traceability
		const row = mapEventToInteraction(emailSent())
		expect(row).not.toBeNull()
		expect(row?.channel).toBe('email')
		expect(row?.direction).toBe('outbound')
		expect(row?.type).toBe('email')
		expect(row?.companyId).toBe('co-1')
		expect(row?.metadata).toContain('em-1')
	})

	it('builds an inbound email row for EmailReceived', () => {
		// GIVEN an EmailReceived event with a resolved companyId
		// WHEN mapEventToInteraction runs
		// THEN it returns direction=inbound
		// AND metadata carries the classification
		const row = mapEventToInteraction(emailReceived())
		expect(row?.direction).toBe('inbound')
		expect(row?.metadata).toContain('normal')
	})

	it('returns null for EmailReceived without a company match', () => {
		// GIVEN an EmailReceived whose companyId is null (ParticipantMatcher said NoMatch)
		// WHEN mapEventToInteraction runs
		// THEN no interaction row is produced — the timeline still lands, but
		// interactions stays keyed to known companies only
		const row = mapEventToInteraction(
			new EmailReceived({
				emailMessageId: 'em-3',
				companyId: null,
				contactId: null,
				subject: null,
				summary: null,
				occurredAt: at,
				classification: 'normal',
			}),
		)
		expect(row).toBeNull()
	})

	it('returns null when InteractionLogged is already attached to an interaction', () => {
		// GIVEN InteractionLogged with attachInteractionId set
		// WHEN mapEventToInteraction runs
		// THEN no new row is produced — the service will reuse the passed id
		expect(
			mapEventToInteraction(
				interactionLogged({ attachInteractionId: 'existing-1' }),
			),
		).toBeNull()
	})

	it('builds an interactions row for InteractionLogged without attachInteractionId', () => {
		// GIVEN an InteractionLogged on channel='call' with no attach (the fresh-
		// insert path — the common shape when a user logs a new call)
		// WHEN mapEventToInteraction runs
		// THEN it returns a row carrying channel/direction/type/companyId verbatim
		// AND date=occurredAt
		// AND metadata stays null (InteractionLogged rows carry their metadata on
		// the interactions.metadata column via the service, not through this map)
		const row = mapEventToInteraction(interactionLogged())
		expect(row).not.toBeNull()
		expect(row?.channel).toBe('call')
		expect(row?.direction).toBe('outbound')
		expect(row?.type).toBe('call')
		expect(row?.companyId).toBe('co-1')
		expect(row?.date).toBe(at)
		expect(row?.metadata).toBeNull()
	})

	it('falls back to channel when InteractionLogged has no type', () => {
		// GIVEN InteractionLogged with type=null on a 'visit' channel
		// WHEN mapEventToInteraction runs
		// THEN type='visit' — the row contract requires a non-null `type` and the
		// channel name is a sensible default (see mapEventToInteraction: `type:
		// event.type ?? event.channel`). Pins the behavior so a future refactor
		// doesn't silently drop the fallback and start inserting NULL.
		const row = mapEventToInteraction(
			interactionLogged({ channel: 'visit', type: null }),
		)
		expect(row?.type).toBe('visit')
		expect(row?.channel).toBe('visit')
	})

	it('returns null for non-touchpoint events', () => {
		// GIVEN DocumentCreated, ProposalEvent, ResearchRunCompleted, SystemEvent
		// WHEN mapEventToInteraction runs
		// THEN none of them produce an interaction row
		expect(
			mapEventToInteraction(
				new DocumentCreated({
					documentId: 'd-1',
					companyId: 'co-1',
					contactId: null,
					title: 'Brief',
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new ProposalEvent({
					proposalId: 'p-1',
					kind: 'sent',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new ResearchRunCompleted({
					researchRunId: 'r-1',
					companyId: 'co-1',
					summary: 'done',
					status: 'succeeded',
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new SystemEvent({
					entityType: 'system',
					entityId: 's-1',
					companyId: null,
					contactId: null,
					summary: 'boot',
					payload: {},
					occurredAt: at,
				}),
			),
		).toBeNull()
	})

	it('returns null for calendar and task events', () => {
		// GIVEN any of the meeting or task tagged events
		// WHEN mapEventToInteraction runs
		// THEN no interactions row is produced — calendar + task events live in
		// timeline_activity and (for tasks) task_events, not in interactions
		expect(
			mapEventToInteraction(
				new MeetingScheduled({
					calendarEventId: 'ce-1',
					companyId: 'co-1',
					contactId: null,
					source: 'booking',
					title: 'Demo',
					startAt: futureStart,
					endAt: new Date('2026-05-01T15:30:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new MeetingRescheduled({
					calendarEventId: 'ce-2',
					companyId: 'co-1',
					contactId: null,
					previousStartAt: futureStart,
					startAt: new Date('2026-06-01T09:00:00Z'),
					endAt: new Date('2026-06-01T10:00:00Z'),
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new MeetingCancelled({
					calendarEventId: 'ce-3',
					companyId: 'co-1',
					contactId: null,
					cancelledStartAt: futureStart,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new MeetingRsvp({
					calendarEventId: 'ce-4',
					attendeeEmail: 'alice@x.com',
					rsvp: 'accepted',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new TaskCreated({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					title: 'Call Acme',
					taskType: 'call',
					actorUserId: null,
					actorKind: 'user',
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new TaskUpdated({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					change: { title: ['old', 'new'] },
					actorUserId: null,
					actorKind: 'agent',
					occurredAt: at,
				}),
			),
		).toBeNull()
		expect(
			mapEventToInteraction(
				new TaskCompleted({
					taskId: 't-1',
					companyId: 'co-1',
					contactId: null,
					actorUserId: null,
					actorKind: 'user',
					occurredAt: at,
				}),
			),
		).toBeNull()
	})
})

describe('TimelineActivityService.record (integration)', () => {
	// DB-backed behaviours — scaffolded as todos until a Postgres test harness lands.

	it.todo(
		// GIVEN an EmailSent event for a known company + contact
		// WHEN record(event) runs
		// THEN a timeline_activity row, an interactions row, and a company/contact
		// cadence bump are all persisted in one transaction
		'should insert timeline_activity + interactions + bump denorm atomically on EmailSent',
	)

	it.todo(
		// GIVEN a failure inside the transaction (e.g., the interactions insert fails)
		// WHEN record(event) runs
		// THEN no timeline_activity, interactions, or denorm-bump side effects remain
		'should roll back all writes when any insert inside the tx fails',
	)

	it.todo(
		// GIVEN an InteractionLogged with attachInteractionId set to an existing row
		// WHEN record(event) runs
		// THEN no new interactions row is created
		// AND the returned interactionId equals the passed attachInteractionId
		'should reuse the passed interaction when attachInteractionId is set',
	)

	it.todo(
		// GIVEN a SystemEvent (no channel, no direction)
		// WHEN record(event) runs
		// THEN cadence columns on companies + contacts are untouched
		'should leave cadence columns unchanged on a SystemEvent',
	)

	it.todo(
		// GIVEN a MeetingScheduled for a future startAt + no prior upcoming event
		// WHEN record(event) runs
		// THEN timeline_activity has a kind='meeting_scheduled' row
		// AND companies.next_calendar_event_at = new startAt
		// AND companies.last_meeting_at is unchanged
		'should set next_calendar_event_at on a future MeetingScheduled via recompute',
	)

	it.todo(
		// GIVEN a MeetingScheduled with startAt in the past (backfilled historical meeting)
		// WHEN record(event) runs
		// THEN companies.last_meeting_at = GREATEST(existing, startAt)
		// AND last_contacted_at is bumped
		// AND next_calendar_event_at is left untouched if there are no future meetings
		'should bump last_meeting_at (not next_calendar_event_at) for a past-dated MeetingScheduled',
	)

	it.todo(
		// GIVEN a single upcoming meeting for company X at start=T
		// WHEN a MeetingRescheduled moves it EARLIER (to T - 1h)
		// THEN companies.next_calendar_event_at = T - 1h (a DECREASE — proves recompute, not GREATEST)
		'should decrease next_calendar_event_at when the only upcoming meeting moves earlier',
	)

	it.todo(
		// GIVEN a single upcoming meeting for company X
		// WHEN a MeetingCancelled arrives for that meeting
		// THEN companies.next_calendar_event_at = NULL (no remaining confirmed future event)
		'should clear next_calendar_event_at when the only upcoming meeting is cancelled',
	)

	it.todo(
		// GIVEN two upcoming meetings for company X at T1 < T2, both confirmed
		// WHEN a MeetingCancelled arrives for the earlier one (T1)
		// THEN companies.next_calendar_event_at = T2
		'should fall back to the next confirmed meeting when the earlier one is cancelled',
	)

	it.todo(
		// GIVEN a past meeting for company X
		// WHEN a MeetingCancelled arrives for it
		// THEN last_meeting_at is unchanged (a cancellation does not rewrite history)
		// AND next_calendar_event_at is recomputed from remaining confirmed future rows
		'should leave last_meeting_at intact when a past meeting is cancelled',
	)

	it.todo(
		// GIVEN a confirmed meeting with attendee alice@x.com at rsvp='needs-action'
		// WHEN a MeetingRsvp (rsvp='accepted') is recorded
		// THEN timeline_activity has a kind='meeting_rsvp' entry
		// AND no cadence columns change (RSVP does not shift meeting times)
		// AND calendar_events.start_at is unchanged
		'should record a MeetingRsvp without mutating cadence columns or the event row',
	)

	it.todo(
		// GIVEN a new task with source='user'
		// WHEN record(TaskCreated) runs
		// THEN timeline_activity has a kind='task_created' row
		// AND no cadence columns on the company change
		'should record TaskCreated without touching cadence columns',
	)

	it.todo(
		// GIVEN a TaskUpdated whose `change.status = ['open','done']`
		// WHEN record(event) runs
		// THEN timeline_activity.kind = 'task_completed' (not 'task_updated')
		// — completion is the intended surface in the global activity feed
		'should classify TaskUpdated with status→done as task_completed',
	)

	it.todo(
		// GIVEN a TaskUpdated whose `change` touches fields OTHER than status
		// WHEN record(event) runs
		// THEN timeline_activity.kind = 'task_updated'
		'should classify non-status TaskUpdated changes as task_updated',
	)
})
