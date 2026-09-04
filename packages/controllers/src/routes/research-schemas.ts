import { Schema } from 'effect'

import { ResearchRun } from '@batuda/domain'

// Response shapes for the research review flow. Date fields encode to ISO
// strings (via DateTimeUtcFromString) so a raw Postgres `Date` never reaches
// the JSON encoder; event payloads and JSON aggregates stay `Unknown` because
// they carry varied shapes and are already plain JSON.

/**
 * A slim research run for lists: enough to render a row (query, status, cost,
 * when) without the heavy findings/context blobs. `costCents`/`paidCostCents`
 * are whole cents. Shared by the run list, a subject's run history, and the
 * list_research MCP tool.
 */
export const ResearchRunSummary = Schema.Struct({
	id: Schema.String,
	kind: Schema.String,
	query: Schema.String,
	mode: Schema.String,
	schemaName: Schema.NullOr(Schema.String),
	status: Schema.String,
	costCents: Schema.Number,
	paidCostCents: Schema.Number,
	createdBy: Schema.String,
	createdAt: Schema.DateTimeUtcFromString,
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
})
export type ResearchRunSummary = typeof ResearchRunSummary.Type

/**
 * A full research run plus the extras the detail view reads: the lifted error
 * text of a failed run, and the run's sources, subject links, and (for a group
 * run) child runs. The nested aggregates arrive as plain JSON from the SQL
 * layer, so they stay `Unknown`; only the run's own columns are typed.
 */
export const ResearchRunDetail = Schema.Struct({
	...ResearchRun.json.fields,
	errorMessage: Schema.NullOr(Schema.String),
	sources: Schema.Array(Schema.Unknown),
	links: Schema.Array(Schema.Unknown),
	children: Schema.Array(Schema.Unknown),
})
export type ResearchRunDetail = typeof ResearchRunDetail.Type

/**
 * A person's research policy: their per-run and paid spend ceilings and the
 * auto-apply confidence threshold (null = auto-apply off). All amounts are
 * whole cents. `updatedAt` is null on the computed default returned before any
 * policy row exists.
 */
export const ResearchPolicy = Schema.Struct({
	budgetCents: Schema.Number,
	paidBudgetCents: Schema.Number,
	autoApprovePaidCents: Schema.Number,
	paidMonthlyCapCents: Schema.Number,
	autoApplyMinConfidence: Schema.NullOr(Schema.Number),
	updatedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
})
export type ResearchPolicy = typeof ResearchPolicy.Type

/**
 * One pending proposed update in the cross-run review inbox: the run + subject
 * it belongs to, the values it would write, and the trust signals a reviewer
 * sorts by. `confidence` is a 0–100 score (or null when the proposal carries
 * none); `verification` is the best email deliverability verdict among its
 * channels; `machineCheckable` is true when the value is an email or phone the
 * system can verify rather than free text.
 *
 * `fields` carries the proposed values and `subjectCurrent` what the record
 * holds today for those same keys, so a caller can show a before-and-after
 * without a request per row. Both are plain JSON, so they stay `Unknown`.
 */
export const PendingProposal = Schema.Struct({
	researchId: Schema.String,
	runKind: Schema.String,
	runStatus: Schema.String,
	runQuery: Schema.String,
	runCreatedAt: Schema.DateTimeUtcFromString,
	runCostCents: Schema.Number,
	runPaidCostCents: Schema.Number,
	proposedUpdateId: Schema.NullOr(Schema.String),
	subjectTable: Schema.NullOr(Schema.String),
	subjectId: Schema.NullOr(Schema.String),
	subjectName: Schema.NullOr(Schema.String),
	operation: Schema.String,
	reason: Schema.NullOr(Schema.String),
	confidence: Schema.NullOr(Schema.Number),
	verification: Schema.NullOr(Schema.String),
	machineCheckable: Schema.Boolean,
	fields: Schema.Unknown,
	citations: Schema.Array(Schema.Unknown),
	subjectCurrent: Schema.NullOr(Schema.Unknown),
})
export type PendingProposal = typeof PendingProposal.Type

/**
 * The outcome of asking to cancel a run. `already_terminal` means the run was
 * finished — or cancelled — by the time the request arrived, so nothing changed
 * and a caller must not report it as a cancellation.
 */
export const CancelResult = Schema.Struct({
	outcome: Schema.Literals(['cancelled', 'already_terminal']),
})
export type CancelResult = typeof CancelResult.Type

/**
 * The outcome of deciding a pending paid action. `approved` carries the
 * follow-up run that will do the paid work; `skipped` spends nothing;
 * `not_pending` means someone else already decided it; `unsupported_tool` means
 * the run named a lookup that does not exist, so it can only ever be skipped.
 * The last two change nothing, so a caller must not report them as an approval.
 */
export const PaidActionResult = Schema.Struct({
	outcome: Schema.Literals([
		'approved',
		'skipped',
		'not_pending',
		'unsupported_tool',
	]),
	followupRunId: Schema.optional(Schema.String),
})
export type PaidActionResult = typeof PaidActionResult.Type

/**
 * The result of applying or rejecting one proposed update. `applied`/`created`
 * carry the row version; `duplicate` names the existing row the change merged
 * onto; `invalid` explains why; `proposal_not_found` means someone already
 * resolved it, which is a harmless no-op rather than a failure and carries the
 * same name the bulk response uses.
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
		'proposal_not_found',
		// Shares the outcome union with the bulk resolve, which is the only place
		// it is ever returned.
		'needs_review',
	]),
	subject_table: Schema.optional(Schema.String),
	subject_id: Schema.optional(Schema.String),
	version: Schema.optional(Schema.Number),
	reason: Schema.optional(Schema.String),
})
export type ProposedUpdateResult = typeof ProposedUpdateResult.Type

/**
 * One paid lookup a run stopped short of paying for, waiting on a person to
 * approve or skip it. `estimatedCents` is what it is expected to cost in whole
 * cents, or null when the run made no estimate. `actionId` is null on a run
 * recorded before these were individually identified — such a one can be seen
 * but not decided. `subjectName` is filled only when the run was about exactly
 * one company or person. `args` is the lookup's own input, so it stays `Unknown`.
 */
export const PendingPaidAction = Schema.Struct({
	researchId: Schema.String,
	runQuery: Schema.String,
	runStatus: Schema.String,
	runCreatedAt: Schema.DateTimeUtcFromString,
	actionId: Schema.NullOr(Schema.String),
	tool: Schema.String,
	args: Schema.Unknown,
	estimatedCents: Schema.NullOr(Schema.Number),
	reason: Schema.NullOr(Schema.String),
	subjectTable: Schema.NullOr(Schema.String),
	subjectId: Schema.NullOr(Schema.String),
	subjectName: Schema.NullOr(Schema.String),
})
export type PendingPaidAction = typeof PendingPaidAction.Type

/**
 * One bucket of paid research spend: what it was grouped by (`key` — a provider,
 * a person or a tool, depending on the request), the whole cents it came to, and
 * how many charged calls made it up. Typed rather than left as free-form JSON so
 * a renamed column fails loudly instead of quietly reading as zero spend.
 */
export const ResearchSpendBucket = Schema.Struct({
	key: Schema.NullOr(Schema.String),
	amountCents: Schema.Number,
	calls: Schema.Number,
})
export type ResearchSpendBucket = typeof ResearchSpendBucket.Type

/**
 * Where a run is, right now — one frame of the live stream a watcher reads.
 *
 * Every figure the run page shows is in here, so a watcher reads the whole page
 * from this one frame instead of re-fetching the run beside it. Each frame is
 * complete rather than a difference from the last, so a watcher that joins late
 * or misses a frame is still correct.
 *
 * All amounts are whole cents. `foundCount` counts the rows this kind of run
 * looks for — companies, people, competitors — and is null for a kind that
 * hunts for none. Both counts are null until the run has written down what it
 * found: zero would say it looked and found none, which is a different thing.
 * `phase` and `activeTool` come from the run's own events, so both are null
 * until it says — including on a page that joined after it last did.
 */
export const ResearchRunLive = Schema.Struct({
	status: Schema.String,
	phase: Schema.NullOr(Schema.Number),
	activeTool: Schema.NullOr(Schema.String),
	sourceCount: Schema.NullOr(Schema.Number),
	progressSteps: Schema.NullOr(Schema.Number),
	costCents: Schema.Number,
	paidCostCents: Schema.Number,
	budgetCents: Schema.Number,
	paidBudgetCents: Schema.Number,
	foundCount: Schema.NullOr(Schema.Number),
	pendingProposalCount: Schema.NullOr(Schema.Number),
	done: Schema.Boolean,
})
export type ResearchRunLive = typeof ResearchRunLive.Type

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
		'needs_review',
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
