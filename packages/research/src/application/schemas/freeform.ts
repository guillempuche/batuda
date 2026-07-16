import { Schema } from 'effect'

import { PendingPaidAction, ProposedUpdate } from './_shared'

/** Freeform research — no structured output, markdown brief only. */
export const FreeformSchema = Schema.Struct({
	proposed_updates: Schema.optionalKey(Schema.Array(ProposedUpdate)),
	pending_paid_actions: Schema.optionalKey(Schema.Array(PendingPaidAction)),
})
