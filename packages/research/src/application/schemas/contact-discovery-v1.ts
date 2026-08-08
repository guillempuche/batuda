import { Schema } from 'effect'

import { VerificationVerdict } from '@batuda/domain'

import {
	Citation,
	DiscoveredExisting,
	LenientNumber,
	PendingPaidAction,
	ProposedUpdate,
} from './_shared'

export const ContactDiscoveryV1Schema = Schema.Struct({
	contacts: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			role: Schema.optionalKey(Schema.String),
			buying_role: Schema.optionalKey(
				Schema.String.annotate({
					description:
						"What part this person plays in deciding whether their company buys: 'economic_buyer' (holds the budget), 'champion' (wants it and argues for it inside), 'gatekeeper' (controls access - procurement, an assistant), 'technical_evaluator' (judges whether it works), 'user' (lives with it). Leave it out unless the evidence actually shows it; several people commonly hold different parts, and guessing one is worse than saying nothing.",
				}),
			),
			// Open channel list (email, phone, linkedin, x, website, bluesky, …).
			// Only the email channel carries a deliverability verdict + confidence.
			channels: Schema.optionalKey(
				Schema.Array(
					Schema.Struct({
						kind: Schema.String,
						value: Schema.String,
						verification: Schema.optionalKey(VerificationVerdict),
						// Required + nullable (see _shared LenientNumber): `optionalKey`
						// around a union serialises to a nested anyOf a strict provider
						// rejects; a channel with no confidence sends null.
						confidence: LenientNumber,
						is_primary: Schema.optionalKey(Schema.Boolean),
					}),
				),
			),
			citations: Schema.Array(Citation),
		}),
	),
	discovered_existing: Schema.optionalKey(Schema.Array(DiscoveredExisting)),
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
