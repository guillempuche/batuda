import { Schema } from 'effect'

// Response shapes for the research review flow. Fields the review UI reads are
// typed; timestamps stay `Unknown` because the SQL layer returns raw dates that
// serialize to JSON on their own (the same trade-off the other route groups
// make), and event payloads stay `Unknown` because they carry varied shapes.

/**
 * One pending proposed update in the cross-run review inbox: the run + subject
 * it belongs to, plus the trust signals a reviewer sorts by. `confidence` is a
 * 0–100 score (or null when the proposal carries none); `verification` is the
 * email deliverability verdict; `machineCheckable` is true when the value is an
 * email or phone the system can verify rather than free text.
 */
export const PendingProposal = Schema.Struct({
	researchId: Schema.String,
	runKind: Schema.String,
	runStatus: Schema.String,
	runQuery: Schema.String,
	runCreatedAt: Schema.Unknown,
	runCostCents: Schema.Number,
	proposedUpdateId: Schema.NullOr(Schema.String),
	subjectTable: Schema.NullOr(Schema.String),
	subjectId: Schema.NullOr(Schema.String),
	subjectName: Schema.NullOr(Schema.String),
	operation: Schema.String,
	reason: Schema.NullOr(Schema.String),
	confidence: Schema.NullOr(Schema.Number),
	verification: Schema.NullOr(Schema.String),
	machineCheckable: Schema.Boolean,
})
export type PendingProposal = typeof PendingProposal.Type

/**
 * The result of applying or rejecting one proposed update. `applied`/`created`
 * carry the row version; `duplicate` names the existing row the change merged
 * onto; `invalid` explains why; the rest carry only the outcome.
 */
export const ProposedUpdateResult = Schema.Struct({
	outcome: Schema.Literals([
		'applied',
		'created',
		'duplicate',
		'rejected',
		'conflict',
		'invalid',
		'no_applicable_fields',
	]),
	subject_table: Schema.optional(Schema.String),
	subject_id: Schema.optional(Schema.String),
	version: Schema.optional(Schema.Number),
	reason: Schema.optional(Schema.String),
})
export type ProposedUpdateResult = typeof ProposedUpdateResult.Type

/**
 * The live-progress contract: a 30-second JSON long-poll (not a raw event
 * stream). `status` is the run's latest status, `events` are the progress
 * events observed in this poll window, and `done` is true once a terminal event
 * arrived. The client re-polls until `done`.
 */
export const ResearchEvents = Schema.Struct({
	status: Schema.String,
	events: Schema.Array(Schema.Unknown),
	done: Schema.Boolean,
})
export type ResearchEvents = typeof ResearchEvents.Type

/**
 * One entry in a bulk apply/reject response. Each names the run + proposal it
 * refers to and its own outcome, so a conflict or error on one proposal doesn't
 * hide the results of the rest. `error` marks a proposal whose resolution threw
 * (as opposed to a clean `conflict`/`invalid`).
 */
export const BulkResolveItemResult = Schema.Struct({
	research_id: Schema.String,
	proposed_update_id: Schema.String,
	outcome: Schema.Literals([
		'applied',
		'created',
		'duplicate',
		'rejected',
		'conflict',
		'invalid',
		'no_applicable_fields',
		'run_not_found',
		'proposal_not_found',
		'error',
	]),
	subject_table: Schema.optional(Schema.String),
	subject_id: Schema.optional(Schema.String),
	version: Schema.optional(Schema.Number),
	reason: Schema.optional(Schema.String),
})

export const BulkResolveResult = Schema.Struct({
	results: Schema.Array(BulkResolveItemResult),
})
export type BulkResolveResult = typeof BulkResolveResult.Type
