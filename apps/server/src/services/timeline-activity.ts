import { Data, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export class EmailSent extends Data.TaggedClass('EmailSent')<{
	readonly emailMessageId: string
	readonly companyId: string
	readonly contactId: string | null
	readonly subject: string | null
	readonly summary: string | null
	readonly actorUserId: string | null
	readonly occurredAt: Date
}> {}

export class EmailReceived extends Data.TaggedClass('EmailReceived')<{
	readonly emailMessageId: string
	readonly companyId: string | null
	readonly contactId: string | null
	readonly subject: string | null
	readonly summary: string | null
	readonly occurredAt: Date
	readonly classification: 'normal' | 'spam' | 'blocked'
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
	readonly status: 'succeeded' | 'failed' | 'cancelled'
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

export type TimelineEvent =
	| EmailSent
	| EmailReceived
	| InteractionLogged
	| DocumentCreated
	| ProposalEvent
	| ResearchRunCompleted
	| SystemEvent
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
	now: Date = new Date(),
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
		case 'DocumentCreated':
		case 'ProposalEvent':
		case 'ResearchRunCompleted':
		case 'SystemEvent':
		case 'MeetingCancelled':
		case 'MeetingRsvp':
		case 'TaskCreated':
		case 'TaskUpdated':
		case 'TaskCompleted':
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

type TimelineKind =
	| 'email_sent'
	| 'email_received'
	| 'call_logged'
	| 'document_created'
	| 'proposal_sent'
	| 'proposal_viewed'
	| 'proposal_responded'
	| 'research_run'
	| 'system_event'
	| 'meeting_scheduled'
	| 'meeting_rescheduled'
	| 'meeting_cancelled'
	| 'meeting_rsvp'
	| 'task_created'
	| 'task_updated'
	| 'task_completed'

type TimelineEntityType =
	| 'email_message'
	| 'interaction'
	| 'call_recording'
	| 'document'
	| 'proposal'
	| 'research_run'
	| 'system'
	| 'calendar_event'
	| 'task'

type TimelineDirection = 'inbound' | 'outbound'

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

const kindForInteractionChannel = (channel: string): TimelineKind => {
	if (channel === 'phone' || channel === 'call') return 'call_logged'
	return 'system_event'
}

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
				payload: { subject: event.subject },
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
				actorUserId: null,
				occurredAt: event.occurredAt,
				summary: event.summary,
				payload: { status: event.status },
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
		case 'DocumentCreated':
		case 'ProposalEvent':
		case 'ResearchRunCompleted':
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
			return event.researchRunId
		case 'SystemEvent':
			return event.entityId
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

export class TimelineActivityService extends ServiceMap.Service<TimelineActivityService>()(
	'TimelineActivityService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

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
							WHERE id = ${companyId}`
					case 'last_call_at':
						return sql`
							UPDATE companies SET
								last_call_at = GREATEST(last_call_at, ${at}),
								last_contacted_at = GREATEST(last_contacted_at, ${at}),
								updated_at = now()
							WHERE id = ${companyId}`
					case 'last_meeting_at':
						return sql`
							UPDATE companies SET
								last_meeting_at = GREATEST(last_meeting_at, ${at}),
								last_contacted_at = GREATEST(last_contacted_at, ${at}),
								updated_at = now()
							WHERE id = ${companyId}`
				}
			}

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
							WHERE id = ${contactId}`
					case 'last_call_at':
						return sql`
							UPDATE contacts SET
								last_call_at = GREATEST(last_call_at, ${at}),
								updated_at = now()
							WHERE id = ${contactId}`
					case 'last_meeting_at':
						return sql`
							UPDATE contacts SET
								last_meeting_at = GREATEST(last_meeting_at, ${at}),
								updated_at = now()
							WHERE id = ${contactId}`
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
				WHERE id = ${companyId}`

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
				): Effect.Effect<RecordResult, never, never> =>
					sql
						.withTransaction(
							Effect.gen(function* () {
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
											INSERT INTO interactions ${sql.insert(interactionRow)} RETURNING id`
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
