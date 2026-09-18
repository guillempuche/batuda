import { Schema } from 'effect'

/**
 * The words a stored message answers to, written once here so every way in
 * uses the same list: the tool descriptions, the web API, the filters and the
 * database's own check.
 *
 * `normal` is ordinary mail. `bounced` is a message a mail server refused, set
 * when the failure notice arrives. `spam` and `blocked` are kept because the
 * database allows them, though nothing writes them today.
 */
export const EMAIL_MESSAGE_STATUSES = [
	'normal',
	'spam',
	'blocked',
	'bounced',
] as const
export const EmailMessageStatus = Schema.Literals(EMAIL_MESSAGE_STATUSES)
export type EmailMessageStatus = typeof EmailMessageStatus.Type

/** Which way a message went. */
export const EMAIL_DIRECTIONS = ['inbound', 'outbound'] as const
export const EmailDirection = Schema.Literals(EMAIL_DIRECTIONS)
export type EmailDirection = typeof EmailDirection.Type

/**
 * How final a refusal was: `hard` is "this address does not exist", `soft` is
 * "not now". A notice that says neither is stored without a type at all.
 */
export const EMAIL_BOUNCE_TYPES = ['hard', 'soft'] as const
export const EmailBounceType = Schema.Literals(EMAIL_BOUNCE_TYPES)
export type EmailBounceType = typeof EmailBounceType.Type

/** What a check made of an arriving message. */
export const INBOUND_CLASSIFICATIONS = ['normal', 'spam', 'blocked'] as const
export const InboundClassification = Schema.Literals(INBOUND_CLASSIFICATIONS)
export type InboundClassification = typeof InboundClassification.Type
