import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ResearchRunId = Schema.String.pipe(Schema.brand('ResearchRunId'))

// A single research run: one query the engine investigates, from queued to a
// terminal status, with its budget, spend, findings, and the instruction set
// that shaped it. A group run fans work out to child runs; a leaf run does the
// work. `organization_id` is intentionally omitted — it's internal isolation,
// never part of the wire shape (same as every other domain model here).
export class ResearchRun extends Model.Class<ResearchRun>('ResearchRun')({
	id: Model.GeneratedByDb(ResearchRunId),
	// Set on a child run to the group run it belongs to; null on a top-level run.
	parentId: Schema.NullOr(Schema.String),

	// values: leaf | group | followup | cache_hit
	kind: Schema.String,
	query: Schema.String,
	// values: deep | fast (how thorough the run is)
	mode: Schema.String,
	// The findings schema the run fills in (e.g. company_enrichment_v1), or null
	// for a freeform run; schemaVersion tracks that schema's revision.
	schemaName: Schema.NullOr(Schema.String),
	schemaVersion: Schema.NullOr(Schema.Number),
	// How far the engine has progressed through its phases.
	phase: Schema.Number,

	// values: queued | running | succeeded | succeeded_low_confidence | failed
	//         | cancelled | deleted | no_reliable_data
	status: Schema.String,
	// The run's inputs (subjects, selector, hints).
	context: Schema.Unknown,

	// The structured result, filled in as the run progresses.
	findings: Schema.Unknown,
	briefMd: Schema.NullOr(Schema.String),
	researchText: Schema.NullOr(Schema.String),

	// All amounts are whole cents. "paid" tracks spend on metered providers;
	// the plain columns track the free budget.
	budgetCents: Schema.Number,
	paidBudgetCents: Schema.Number,
	costCents: Schema.Number,
	paidCostCents: Schema.Number,
	costBreakdown: Schema.Unknown,
	quotaBreakdown: Schema.Unknown,
	tokensIn: Schema.Number,
	tokensOut: Schema.Number,
	paidPolicy: Schema.Unknown,

	idempotencyKey: Schema.NullOr(Schema.String),
	createdBy: Schema.String,
	createdAt: Model.DateTimeInsertFromDate,
	// Null until the engine picks the run up / finishes it.
	startedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	updatedAt: Model.DateTimeUpdateFromDate,

	// A running log of the tool calls the engine made.
	toolLog: Schema.Unknown,

	// Provenance of the instruction templates that shaped the run, frozen at
	// creation so they survive later edits/deletes of those templates.
	templateIds: Schema.Unknown,
	templateFingerprint: Schema.String,
	templateNames: Schema.Unknown,
	instructionSegments: Schema.Unknown,

	// Liveness beat, refreshed while the run is active; null before it starts.
	heartbeatAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	// How strongly the fetched evidence matched the researched entity
	// (strong | weak | absent), or null when the run wasn't entity-gated.
	entityMatch: Schema.NullOr(Schema.String),
	// A structured code for why a run ended without usable data, or null.
	reasonCode: Schema.NullOr(Schema.String),
}) {}

// The statuses that end a run — nothing more happens to it. Anything polling a
// run for completion keys off this set, so a new terminal status is added here
// once and every poller sees it.
export const TERMINAL_RESEARCH_STATUSES = [
	'succeeded',
	'succeeded_low_confidence',
	'no_reliable_data',
	'failed',
	'cancelled',
	'deleted',
] as const

// The terminal statuses that carry usable findings. A low-confidence success is
// flagged for review, not discarded, so it counts as a success that produced data.
export const SUCCEEDED_RESEARCH_STATUSES = [
	'succeeded',
	'succeeded_low_confidence',
] as const

export const isTerminalResearchStatus = (status: string): boolean =>
	(TERMINAL_RESEARCH_STATUSES as ReadonlyArray<string>).includes(status)

export const isSucceededResearchStatus = (status: string): boolean =>
	(SUCCEEDED_RESEARCH_STATUSES as ReadonlyArray<string>).includes(status)
