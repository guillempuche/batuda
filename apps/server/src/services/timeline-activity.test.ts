import { describe, expect, it } from 'vitest'

import {
	DocumentCreated,
	denormColumnFor,
	EmailReceived,
	EmailSent,
	InteractionLogged,
	mapEventToInteraction,
	ProposalEvent,
	ResearchRunCompleted,
	SystemEvent,
} from './timeline-activity'

const at = new Date('2026-04-18T10:00:00Z')

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
})
