import { Schema } from 'effect'

/** Where an address stood on a message. */
export const PARTICIPANT_ROLES = ['from', 'to', 'cc', 'bcc'] as const
export const ParticipantRole = Schema.Literals(PARTICIPANT_ROLES)
export type ParticipantRole = typeof ParticipantRole.Type
