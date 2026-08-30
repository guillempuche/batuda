import { Context, Data, DateTime, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	CurrentOrg,
	type TimelineDirection,
	type TimelineEntityType,
	type TimelineKind,
} from '@batuda/domain'

export class EmailSent extends Data.TaggedClass('EmailSent')<{
	readonly emailMessageId: string
	readonly companyId: string
	readonly contactId: string | null
	readonly subject: string | null
	readonly summary: string | null
	// The conversation this message belongs to, so the history entry can
	// open it.
	readonly threadLinkId: string | null
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class EmailReceived extends Data.TaggedClass('EmailReceived')<{
	readonly emailMessageId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly subject: string | null
	readonly summary: string | null
	// The conversation this message belongs to, so the history entry can open
	// it — the same field a sent one carries.
	readonly threadLinkId: string | null
	readonly occurredAt: Date
	readonly classification: 'normal' | 'spam' | 'blocked'
}> {}

// A message we sent came back undelivered. Filed against the person it could
// not reach where the address belongs to one, and against nobody in particular
// where it does not — a bounce from an address on no contact still says the
// send failed.
export class EmailBounced extends Data.TaggedClass('EmailBounced')<{
	readonly emailMessageId: string
	readonly companyId: string | null
	readonly contactId: string | null
	// The bounced message's own RFC id, as the mail server named it back to us.
	readonly originalMessageId: string | null
	readonly bounceType: string | null
	readonly status: string | null
	readonly diagnostic: string | null
	readonly recipients: ReadonlyArray<string>
	readonly occurredAt: Date
}> {}

export class InteractionLogged extends Data.TaggedClass('InteractionLogged')<{
	readonly companyId: string
	readonly contactId: string | null
	readonly channel: string
	readonly direction: 'inbound' | 'outbound'
	readonly type: string | null
	readonly subject: string | null
	readonly summary: string | null
	readonly outcome: string | null
	readonly nextAction: string | null
	readonly nextActionAt: Date | null
	readonly durationMin: number | null
	readonly occurredAt: Date
	readonly actorUserId: string | null
	readonly attachInteractionId: string | null
}> {}

export class DocumentCreated extends Data.TaggedClass('DocumentCreated')<{
	readonly documentId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly title: string
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class ProposalEvent extends Data.TaggedClass('ProposalEvent')<{
	readonly proposalId: string
	readonly kind: 'sent' | 'viewed' | 'responded'
	readonly companyId: string
	readonly contactId: string | null
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class ResearchRunCompleted extends Data.TaggedClass(
	'ResearchRunCompleted',
)<{
	readonly researchRunId: string
	readonly companyId: string | null
	readonly summary: string
	// Coming up empty is recorded like any other ending: it cost time and money,
	// and it is still an answer the person who asked for it needs.
	readonly status:
		| 'succeeded'
		| 'succeeded_low_confidence'
		| 'failed'
		| 'cancelled'
		| 'no_reliable_data'
	// Whoever asked for the run, so their own finished research can be found.
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

// A research suggestion a human (or the auto-apply policy) accepted onto a CRM
// row: records who applied it, when, from which run, and which fields changed,
// so the change is auditable on the subject's and company's timeline.
export class ResearchProposalApplied extends Data.TaggedClass(
	'ResearchProposalApplied',
)<{
	readonly researchRunId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly subjectTable: 'companies' | 'contacts'
	readonly subjectId: string
	readonly operation: 'created' | 'updated' | 'duplicate'
	readonly appliedFields: ReadonlyArray<string>
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class SystemEvent extends Data.TaggedClass('SystemEvent')<{
	readonly entityType: string
	readonly entityId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly summary: string
	readonly payload: Record<string, unknown>
	readonly occurredAt: Date
}> {}

export class MeetingScheduled extends Data.TaggedClass('MeetingScheduled')<{
	readonly calendarEventId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly source: 'booking' | 'email' | 'internal'
	readonly title: string
	readonly startAt: Date
	readonly endAt: Date
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class MeetingRescheduled extends Data.TaggedClass('MeetingRescheduled')<{
	readonly calendarEventId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly previousStartAt: Date
	readonly startAt: Date
	readonly endAt: Date
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class MeetingCancelled extends Data.TaggedClass('MeetingCancelled')<{
	readonly calendarEventId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly cancelledStartAt: Date
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class MeetingRsvp extends Data.TaggedClass('MeetingRsvp')<{
	readonly calendarEventId: string
	readonly attendeeEmail: string
	readonly rsvp: 'accepted' | 'declined' | 'tentative'
	readonly companyId: string | null
	readonly contactId: string | null
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class TaskCreated extends Data.TaggedClass('TaskCreated')<{
	readonly taskId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly title: string
	readonly taskType: string
	readonly actorUserId: string | null
	readonly actorKind: 'user' | 'agent'
	readonly occurredAt: Date
}> {}

export class TaskUpdated extends Data.TaggedClass('TaskUpdated')<{
	readonly taskId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly change: Record<string, readonly [unknown, unknown]>
	readonly actorUserId: string | null
	readonly actorKind: 'user' | 'agent'
	readonly occurredAt: Date
}> {}

export class TaskCompleted extends Data.TaggedClass('TaskCompleted')<{
	readonly taskId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly actorUserId: string | null
	readonly actorKind: 'user' | 'agent'
	readonly occurredAt: Date
}> {}

// A pipeline stage transition (company.status changed from → to). Recorded as a
// system-kind activity so it shows on the company's history; the human-readable
// label is localized in the UI from the structured payload, never here.
export class StageChanged extends Data.TaggedClass('StageChanged')<{
	readonly companyId: string
	readonly from: string | null
	readonly to: string
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class CompanyDeleted extends Data.TaggedClass('CompanyDeleted')<{
	readonly companyId: string
	readonly contactsAffected: number
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class CompanyRestored extends Data.TaggedClass('CompanyRestored')<{
	readonly companyId: string
	readonly contactsAffected: number
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

// A lead nobody had claimed became somebody's. Written when the first person to
// email a company takes it, so the history says why the owner appeared rather
// than leaving it to be noticed. `ownerUserId` is who got it; `actorUserId` is
// who did it — the same person today, kept apart because handing a lead to
// somebody else is the obvious next thing to want.
export class LeadAssigned extends Data.TaggedClass('LeadAssigned')<{
	readonly companyId: string
	readonly ownerUserId: string
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export type TimelineEvent =
	| EmailSent
	| EmailReceived
	| EmailBounced
	| InteractionLogged
	| DocumentCreated
	| ProposalEvent
	| ResearchRunCompleted
	| ResearchProposalApplied
	| SystemEvent
	| StageChanged
	| CompanyDeleted
	| CompanyRestored
	| LeadAssigned
	| MeetingScheduled
	| MeetingRescheduled
	| MeetingCancelled
	| MeetingRsvp
	| TaskCreated
	| TaskUpdated
	| TaskCompleted

export type DenormColumn = 'last_email_at' | 'last_call_at' | 'last_meeting_at'

const isPast = (at: Date, now: Date) => at.getTime() <= now.getTime()

export const denormColumnFor = (
	event: TimelineEvent,
	now: Date = DateTime.toDateUtc(DateTime.nowUnsafe()),
): DenormColumn | null => {
	switch (event._tag) {
		case 'EmailSent':
		case 'EmailReceived':
			return 'last_email_at'
		case 'InteractionLogged':
			if (event.channel === 'phone' || event.channel === 'call')
				return 'last_call_at'
			if (event.channel === 'visit' || event.channel === 'event')
				return 'last_meeting_at'
			return null
		case 'MeetingScheduled':
		case 'MeetingRescheduled':
			return isPast(event.startAt, now) ? 'last_meeting_at' : null
		case 'StageChanged':
		case 'LeadAssigned':
		// A bounce is a send that did not arrive. The send already moved the
		// date, and failing to arrive is not a later contact.
		case 'EmailBounced':
			return null
		case 'DocumentCreated':
		case 'ProposalEvent':
		case 'ResearchRunCompleted':
		case 'ResearchProposalApplied':
		case 'SystemEvent':
		case 'MeetingCancelled':
		case 'MeetingRsvp':
		case 'TaskCreated':
		case 'TaskUpdated':
		case 'TaskCompleted':
		case 'CompanyDeleted':
		case 'CompanyRestored':
			return null
	}
}

// Meetings that may shift `next_calendar_event_at` must recompute from
// calendar_events, not GREATEST — rescheduling earlier or cancelling the only
// upcoming event can DECREASE the value.
export const needsNextMeetingRecompute = (event: TimelineEvent): boolean =>
	event._tag === 'MeetingScheduled' ||
	event._tag === 'MeetingRescheduled' ||
	event._tag === 'MeetingCancelled'

// The shared schema holds the one list of allowed kinds and entity types: a
// row written with a value it doesn't know fails to decode for everyone
// reading that company's history.
interface TimelineRowBase {
	kind: TimelineKind
	entityType: TimelineEntityType
	companyId: string | null
	contactId: string | null
	channel: string | null
	direction: TimelineDirection | null
	actorUserId: string | null
	occurredAt: Date
	summary: string | null
	payload: Record<string, unknown>
}

// Only calls get a kind of their own; every other channel is named in the
// row's `channel` column, so adding one never needs a new kind here.
export const kindForInteractionChannel = (channel: string): TimelineKind =>
	channel === 'phone' || channel === 'call'
		? 'call_logged'
		: 'interaction_logged'

const rowBase = (event: TimelineEvent): TimelineRowBase => {
	switch (event._tag) {
		case 'EmailSent':
			return {
				kind: 'email_sent',
				entityType: 'email_message',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'email',
				direction: 'outbound',
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: event.summary,
				payload: { subject: event.subject, threadLinkId: event.threadLinkId },
			}
		case 'EmailReceived':
			return {
				kind: 'email_received',
				entityType: 'email_message',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'email',
				direction: 'inbound',
				actorUserId: null,
				occurredAt: event.occurredAt,
				summary: event.summary,
				payload: {
					subject: event.subject,
					classification: event.classification,
					threadLinkId: event.threadLinkId,
				},
			}
		case 'EmailBounced':
			return {
				kind: 'email_bounced',
				entityType: 'email_message',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'email',
				// The failure is about a message we sent, so it reads with the
				// send rather than against it.
				direction: 'outbound',
				actorUserId: null,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					originalMessageId: event.originalMessageId,
					status: event.status,
					diagnostic: event.diagnostic,
					recipients: event.recipients,
					bounceType: event.bounceType,
				},
			}
		case 'InteractionLogged':
			return {
				kind: kindForInteractionChannel(event.channel),
				entityType: 'interaction',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: event.channel,
				direction: event.direction,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: event.summary,
				payload: {
					type: event.type,
					subject: event.subject,
					outcome: event.outcome,
					nextAction: event.nextAction,
					nextActionAt: event.nextActionAt,
					durationMin: event.durationMin,
				},
			}
		case 'DocumentCreated':
			return {
				kind: 'document_created',
				entityType: 'document',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: event.title,
				payload: {},
			}
		case 'ProposalEvent':
			return {
				kind:
					event.kind === 'sent'
						? 'proposal_sent'
						: event.kind === 'viewed'
							? 'proposal_viewed'
							: 'proposal_responded',
				entityType: 'proposal',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: event.kind === 'responded' ? 'inbound' : 'outbound',
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {},
			}
		case 'ResearchRunCompleted':
			return {
				kind: 'research_run',
				entityType: 'research_run',
				companyId: event.companyId,
				contactId: null,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: event.summary,
				payload: { status: event.status },
			}
		case 'ResearchProposalApplied':
			return {
				kind: 'research_applied',
				entityType: 'research_run',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					subjectTable: event.subjectTable,
					subjectId: event.subjectId,
					operation: event.operation,
					appliedFields: event.appliedFields,
				},
			}
		case 'SystemEvent':
			return {
				kind: 'system_event',
				entityType: 'system',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: null,
				actorUserId: null,
				occurredAt: event.occurredAt,
				summary: event.summary,
				payload: event.payload,
			}
		case 'CompanyDeleted':
		case 'CompanyRestored':
			return {
				kind:
					event._tag === 'CompanyDeleted'
						? 'company_deleted'
						: 'company_restored',
				entityType: 'system',
				companyId: event.companyId,
				contactId: null,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: { contactsAffected: event.contactsAffected },
			}
		case 'StageChanged':
			return {
				kind: 'stage_changed',
				entityType: 'system',
				companyId: event.companyId,
				contactId: null,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: { from: event.from, to: event.to },
			}
		case 'LeadAssigned':
			return {
				kind: 'lead_assigned',
				entityType: 'system',
				companyId: event.companyId,
				contactId: null,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				// `reason` says what put the owner there, so a later way of
				// assigning is told apart without guessing from the timestamp.
				payload: { ownerUserId: event.ownerUserId, reason: 'first_email' },
			}
		case 'MeetingScheduled':
			return {
				kind: 'meeting_scheduled',
				entityType: 'calendar_event',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'calendar',
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: event.title,
				payload: {
					source: event.source,
					startAt: event.startAt,
					endAt: event.endAt,
				},
			}
		case 'MeetingRescheduled':
			return {
				kind: 'meeting_rescheduled',
				entityType: 'calendar_event',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'calendar',
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					previousStartAt: event.previousStartAt,
					startAt: event.startAt,
					endAt: event.endAt,
				},
			}
		case 'MeetingCancelled':
			return {
				kind: 'meeting_cancelled',
				entityType: 'calendar_event',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'calendar',
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					cancelledStartAt: event.cancelledStartAt,
				},
			}
		case 'MeetingRsvp':
			return {
				kind: 'meeting_rsvp',
				entityType: 'calendar_event',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: 'calendar',
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					attendeeEmail: event.attendeeEmail,
					rsvp: event.rsvp,
				},
			}
		case 'TaskCreated':
			return {
				kind: 'task_created',
				entityType: 'task',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: event.title,
				payload: {
					taskType: event.taskType,
					actorKind: event.actorKind,
				},
			}
		case 'TaskUpdated': {
			const statusChange = event.change['status']
			const transitionsToDone =
				Array.isArray(statusChange) && statusChange[1] === 'done'
			return {
				kind: transitionsToDone ? 'task_completed' : 'task_updated',
				entityType: 'task',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					change: event.change,
					actorKind: event.actorKind,
				},
			}
		}
		case 'TaskCompleted':
			return {
				kind: 'task_completed',
				entityType: 'task',
				companyId: event.companyId,
				contactId: event.contactId,
				channel: null,
				direction: null,
				actorUserId: event.actorUserId,
				occurredAt: event.occurredAt,
				summary: null,
				payload: {
					actorKind: event.actorKind,
				},
			}
	}
}

export interface InteractionInsert {
	companyId: string
	contactId: string | null
	date: Date
	channel: string
	direction: string
	type: string
	subject: string | null
	summary: string | null
	outcome: string | null
	nextAction: string | null
	nextActionAt: Date | null
	durationMin: number | null
	metadata: string | null
	[key: string]: unknown
}

export const mapEventToInteraction = (
	event: TimelineEvent,
): InteractionInsert | null => {
	switch (event._tag) {
		case 'EmailSent':
			return {
				companyId: event.companyId,
				contactId: event.contactId,
				date: event.occurredAt,
				channel: 'email',
				direction: 'outbound',
				type: 'email',
				subject: event.subject,
				summary: event.summary,
				outcome: null,
				nextAction: null,
				nextActionAt: null,
				durationMin: null,
				metadata: JSON.stringify({ emailMessageId: event.emailMessageId }),
			}
		case 'EmailReceived':
			if (!event.companyId) return null
			return {
				companyId: event.companyId,
				contactId: event.contactId,
				date: event.occurredAt,
				channel: 'email',
				direction: 'inbound',
				type: 'email',
				subject: event.subject,
				summary: event.summary,
				outcome: null,
				nextAction: null,
				nextActionAt: null,
				durationMin: null,
				metadata: JSON.stringify({
					emailMessageId: event.emailMessageId,
					classification: event.classification,
				}),
			}
		case 'InteractionLogged':
			if (event.attachInteractionId) return null
			return {
				companyId: event.companyId,
				contactId: event.contactId,
				date: event.occurredAt,
				channel: event.channel,
				direction: event.direction,
				type: event.type ?? event.channel,
				subject: event.subject,
				summary: event.summary,
				outcome: event.outcome,
				nextAction: event.nextAction,
				nextActionAt: event.nextActionAt,
				durationMin: event.durationMin,
				metadata: null,
			}
		case 'CompanyDeleted':
		case 'CompanyRestored':
		case 'StageChanged':
		case 'LeadAssigned':
		// Nobody was reached, so there is no touchpoint to log.
		case 'EmailBounced': {
			return null
		}
		case 'DocumentCreated':
		case 'ProposalEvent':
		case 'ResearchRunCompleted':
		case 'ResearchProposalApplied':
		case 'SystemEvent':
		case 'MeetingScheduled':
		case 'MeetingRescheduled':
		case 'MeetingCancelled':
		case 'MeetingRsvp':
		case 'TaskCreated':
		case 'TaskUpdated':
		case 'TaskCompleted':
			return null
	}
}

const entityIdFor = (
	event: TimelineEvent,
	resolvedInteractionId: string | null,
): string => {
	switch (event._tag) {
		case 'EmailSent':
		case 'EmailReceived':
		case 'EmailBounced':
			return event.emailMessageId
		case 'InteractionLogged': {
			const id = event.attachInteractionId ?? resolvedInteractionId
			if (!id) {
				throw new Error(
					'InteractionLogged requires either attachInteractionId or a freshly inserted interaction',
				)
			}
			return id
		}
		case 'DocumentCreated':
			return event.documentId
		case 'ProposalEvent':
			return event.proposalId
		case 'ResearchRunCompleted':
		case 'ResearchProposalApplied':
			return event.researchRunId
		case 'SystemEvent':
			return event.entityId
		case 'StageChanged':
		case 'CompanyDeleted':
		case 'CompanyRestored':
		case 'LeadAssigned':
			return event.companyId
		case 'MeetingScheduled':
		case 'MeetingRescheduled':
		case 'MeetingCancelled':
		case 'MeetingRsvp':
			return event.calendarEventId
		case 'TaskCreated':
		case 'TaskUpdated':
		case 'TaskCompleted':
			return event.taskId
	}
}

export interface RecordResult {
	readonly activityId: string
	readonly interactionId: string | null
}

export class TimelineActivityService extends Context.Service<TimelineActivityService>()(
	'TimelineActivityService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			// A company out of view is not brought forward by anything arriving
			// for it — mail, calls and meetings all leave its dates where they were,
			// so restoring it shows the account as it was when it was dropped.
			const bumpCompany = (
				column: DenormColumn,
				companyId: string,
				at: Date,
			) => {
				switch (column) {
					case 'last_email_at':
						return sql`
							UPDATE companies SET
								last_email_at = GREATEST(last_email_at, ${at}),
								last_contacted_at = GREATEST(last_contacted_at, ${at}),
								updated_at = now()
							WHERE id = ${companyId} AND deleted_at IS NULL`
					case 'last_call_at':
						return sql`
							UPDATE companies SET
								last_call_at = GREATEST(last_call_at, ${at}),
								last_contacted_at = GREATEST(last_contacted_at, ${at}),
								updated_at = now()
							WHERE id = ${companyId} AND deleted_at IS NULL`
					case 'last_meeting_at':
						return sql`
							UPDATE companies SET
								last_meeting_at = GREATEST(last_meeting_at, ${at}),
								last_contacted_at = GREATEST(last_contacted_at, ${at}),
								updated_at = now()
							WHERE id = ${companyId} AND deleted_at IS NULL`
				}
			}

			// Somebody out of view is left where they were, for the same reason
			// their company is: restoring them should show what was true when
			// they were dropped, not what has arrived for them since.
			const bumpContact = (
				column: DenormColumn,
				contactId: string,
				at: Date,
			) => {
				switch (column) {
					case 'last_email_at':
						return sql`
							UPDATE contacts SET
								last_email_at = GREATEST(last_email_at, ${at}),
								updated_at = now()
							WHERE id = ${contactId} AND deleted_at IS NULL`
					case 'last_call_at':
						return sql`
							UPDATE contacts SET
								last_call_at = GREATEST(last_call_at, ${at}),
								updated_at = now()
							WHERE id = ${contactId} AND deleted_at IS NULL`
					case 'last_meeting_at':
						return sql`
							UPDATE contacts SET
								last_meeting_at = GREATEST(last_meeting_at, ${at}),
								updated_at = now()
							WHERE id = ${contactId} AND deleted_at IS NULL`
				}
			}

			const recomputeCompanyNextMeeting = (companyId: string) => sql`
				UPDATE companies SET
					next_calendar_event_at = (
						SELECT MIN(start_at) FROM calendar_events
						WHERE company_id = ${companyId}
							AND status = 'confirmed'
							AND start_at > now()
					),
					updated_at = now()
				WHERE id = ${companyId} AND deleted_at IS NULL`

			const recomputeContactNextMeeting = (contactId: string) => sql`
				UPDATE contacts SET
					next_calendar_event_at = (
						SELECT MIN(start_at) FROM calendar_events
						WHERE contact_id = ${contactId}
							AND status = 'confirmed'
							AND start_at > now()
					),
					updated_at = now()
				WHERE id = ${contactId}`

			return {
				record: (
					event: TimelineEvent,
				): Effect.Effect<RecordResult, never, CurrentOrg> =>
					sql
						.withTransaction(
							Effect.gen(function* () {
								const currentOrg = yield* CurrentOrg
								let resolvedInteractionId: string | null = null

								if (event._tag === 'InteractionLogged') {
									if (event.attachInteractionId) {
										resolvedInteractionId = event.attachInteractionId
									} else {
										const interactionRow = mapEventToInteraction(event)
										if (interactionRow) {
											const inserted = yield* sql<{ id: string }>`
												INSERT INTO interactions ${sql.insert({
													...interactionRow,
													organizationId: currentOrg.id,
													metadata: interactionRow.metadata,
												})} RETURNING id`
											const [created] = inserted
											if (!created) {
												return yield* Effect.die(
													new Error(
														'INSERT INTO interactions RETURNING id yielded no row',
													),
												)
											}
											resolvedInteractionId = created.id
										}
									}
								} else {
									const interactionRow = mapEventToInteraction(event)
									if (interactionRow) {
										const inserted = yield* sql<{ id: string }>`
											INSERT INTO interactions ${sql.insert({
												...interactionRow,
												organizationId: currentOrg.id,
											})} RETURNING id`
										const [created] = inserted
										if (!created) {
											return yield* Effect.die(
												new Error(
													'INSERT INTO interactions RETURNING id yielded no row',
												),
											)
										}
										resolvedInteractionId = created.id
									}
								}

								const base = rowBase(event)
								const entityId = entityIdFor(event, resolvedInteractionId)
								const activityRows = yield* sql<{ id: string }>`
									INSERT INTO timeline_activity ${sql.insert({
										organizationId: currentOrg.id,
										kind: base.kind,
										entityType: base.entityType,
										entityId,
										companyId: base.companyId,
										contactId: base.contactId,
										channel: base.channel,
										direction: base.direction,
										actorUserId: base.actorUserId,
										occurredAt: base.occurredAt,
										summary: base.summary,
										payload: JSON.stringify(base.payload),
									})} RETURNING id`
								const [activity] = activityRows
								if (!activity) {
									return yield* Effect.die(
										new Error(
											'INSERT INTO timeline_activity RETURNING id yielded no row',
										),
									)
								}

								const column = denormColumnFor(event)
								// For meetings, the column bump uses the meeting's `startAt`
								// (time the meeting happened), not `occurredAt` (when we
								// recorded the activity).
								const bumpAt =
									event._tag === 'MeetingScheduled' ||
									event._tag === 'MeetingRescheduled'
										? event.startAt
										: event.occurredAt
								if (column && base.companyId) {
									yield* bumpCompany(column, base.companyId, bumpAt)
								}
								if (column && base.contactId) {
									yield* bumpContact(column, base.contactId, bumpAt)
								}

								if (needsNextMeetingRecompute(event)) {
									if (base.companyId) {
										yield* recomputeCompanyNextMeeting(base.companyId)
									}
									if (base.contactId) {
										yield* recomputeContactNextMeeting(base.contactId)
									}
								}

								return {
									activityId: activity.id,
									interactionId: resolvedInteractionId,
								}
							}),
						)
						.pipe(Effect.orDie),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
