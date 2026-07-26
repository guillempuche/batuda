import { Schema } from 'effect'

import { VerificationVerdict } from '../../domain/types'
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
			is_decision_maker: Schema.optionalKey(Schema.Boolean),
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
