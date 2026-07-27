import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { ResearchSubjectTable } from '@batuda/domain'

import {
	ConfirmRequired,
	InsufficientBudget,
	NotFound,
	UnknownStack,
} from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { PaginatedList, pageQuery } from '../pagination'
import {
	BulkResolveResult,
	CancelResult,
	PaidActionResult,
	PendingPaidAction,
	PendingProposal,
	ProposedUpdateResult,
	ResearchEvents,
	ResearchPolicy,
	ResearchRunDetail,
	ResearchRunSummary,
	ResearchSpendBucket,
} from './research-schemas'

// ── Input schemas ──

const SubjectRef = Schema.Struct({
	table: ResearchSubjectTable,
	id: Schema.String,
})

// A selector fans a run out across matching companies. The filter is a small,
// safe subset of company columns (not arbitrary SQL) so it can be turned into a
// parameterized query without opening an injection surface.
const SelectorRef = Schema.Struct({
	table: Schema.Literal('companies'),
	filter: Schema.Struct({
		status: Schema.optional(Schema.String),
		industry: Schema.optional(Schema.String),
		country: Schema.optional(Schema.String),
		tags: Schema.optional(Schema.Array(Schema.String)),
	}),
})

const Hints = Schema.Struct({
	language: Schema.optional(Schema.Literals(['ca', 'es', 'en'])),
	recency_days: Schema.optional(Schema.Number),
	location: Schema.optional(Schema.String),
	// The employee-count band a prospecting request asked for, so a scan can leave
	// out a company outside it.
	min_employees: Schema.optional(Schema.Number),
	max_employees: Schema.optional(Schema.Number),
})

// Exported so the MCP tools can validate a caller's `context` against the same
// shape the HTTP route enforces. Without this the MCP path took `context` as an
// unchecked `unknown` and a selector missing its `filter` wrapper reached the
// engine and crashed on `filter.status`.
export const ContextInput = Schema.Struct({
	subjects: Schema.optional(Schema.Array(SubjectRef)),
	selector: Schema.optional(SelectorRef),
	hints: Schema.optional(Hints),
})

const CreateResearchInput = Schema.Struct({
	query: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	mode: Schema.optional(Schema.String),
	context: Schema.optional(ContextInput),
	schema_name: Schema.optional(Schema.String),
	budget_cents: Schema.optional(Schema.Number),
	paid_budget_cents: Schema.optional(Schema.Number),
	auto_approve_paid_cents: Schema.optional(Schema.Number),
	confirm: Schema.optional(Schema.Boolean),
	// A saved stack (id) and/or ad-hoc extra templates for this run. The UI holds
	// ids, so only ids are accepted here (the MCP surface resolves names).
	stack_id: Schema.optional(Schema.String),
	template_ids: Schema.optional(Schema.Array(Schema.String)),
})

const UpdatePolicyInput = Schema.Struct({
	budget_cents: Schema.optional(Schema.Number),
	paid_budget_cents: Schema.optional(Schema.Number),
	auto_approve_paid_cents: Schema.optional(Schema.Number),
	paid_monthly_cap_cents: Schema.optional(Schema.Number),
	// Nullable so the client can turn auto-apply off by sending null.
	auto_apply_min_confidence: Schema.optional(Schema.NullOr(Schema.Number)),
})

const AttachInput = Schema.Struct({
	subject_table: ResearchSubjectTable,
	subject_id: Schema.String,
})

const RerunInput = Schema.Struct({
	domain: Schema.String,
})

const BulkResolveInput = Schema.Struct({
	items: Schema.Array(
		Schema.Struct({
			research_id: Schema.String,
			proposed_update_id: Schema.String,
			decision: Schema.Literals(['apply', 'reject']),
		}),
	),
})

// ── Route group ──

export const ResearchGroup = HttpApiGroup.make('research')
	// POST /research — create + fork
	.add(
		HttpApiEndpoint.post('create', '/research', {
			payload: CreateResearchInput,
			success: Schema.Unknown,
			error: [
				InsufficientBudget.pipe(HttpApiSchema.status(409)),
				ConfirmRequired.pipe(HttpApiSchema.status(409)),
				UnknownStack.pipe(HttpApiSchema.status(422)),
			],
		}),
	)
	// GET /research — list, filter, paginate
	.add(
		HttpApiEndpoint.get('list', '/research', {
			query: {
				created_by: Schema.optional(Schema.String),
				status: Schema.optional(Schema.String),
				subject_table: Schema.optional(Schema.String),
				subject_id: Schema.optional(Schema.String),
				since: Schema.optional(Schema.String),
				...pageQuery,
			},
			success: PaginatedList(ResearchRunSummary),
		}),
	)
	// GET /research/:id — full row with findings + sources
	.add(
		HttpApiEndpoint.get('get', '/research/:id', {
			params: { id: Schema.String },
			success: ResearchRunDetail,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	// GET /research/:id/events — 30-second JSON long-poll of run progress; the
	// client re-polls until `done`. Not a raw event stream.
	.add(
		HttpApiEndpoint.get('events', '/research/:id/events', {
			params: { id: Schema.String },
			success: ResearchEvents,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	// POST /research/:id/cancel
	.add(
		HttpApiEndpoint.post('cancel', '/research/:id/cancel', {
			params: { id: Schema.String },
			success: CancelResult,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	// POST /research/:id/attach — post-hoc link
	.add(
		HttpApiEndpoint.post('attach', '/research/:id/attach', {
			params: { id: Schema.String },
			payload: AttachInput,
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	// POST /research/:id/rerun — target correction: re-run anchored to a domain
	.add(
		HttpApiEndpoint.post('rerun', '/research/:id/rerun', {
			params: { id: Schema.String },
			payload: RerunInput,
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	// DELETE /research/:id — soft-delete
	.add(
		HttpApiEndpoint.delete('delete', '/research/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
		}),
	)
	// GET /research/by-subject/:table/:id
	.add(
		HttpApiEndpoint.get('bySubject', '/research/by-subject/:table/:subjectId', {
			params: {
				table: Schema.String,
				subjectId: Schema.String,
			},
			success: Schema.Array(ResearchRunSummary),
		}),
	)
	// Paid action approval workflow
	.add(
		HttpApiEndpoint.post(
			'approvePaidAction',
			'/research/:id/paid-actions/:paId/approve',
			{
				params: { id: Schema.String, paId: Schema.String },
				success: PaidActionResult,
				error: NotFound.pipe(HttpApiSchema.status(404)),
			},
		),
	)
	.add(
		HttpApiEndpoint.post(
			'skipPaidAction',
			'/research/:id/paid-actions/:paId/skip',
			{
				params: { id: Schema.String, paId: Schema.String },
				success: PaidActionResult,
				error: NotFound.pipe(HttpApiSchema.status(404)),
			},
		),
	)
	// Every paid lookup in the org still waiting on a decision. A run parks these
	// and stops before spending, so without this list nothing surfaces one until
	// somebody opens that run. Static path wins over /research/:id.
	.add(
		HttpApiEndpoint.get('listPendingPaidActions', '/research/paid-actions', {
			query: {
				research_id: Schema.optional(Schema.String),
				...pageQuery,
			},
			success: PaginatedList(PendingPaidAction),
		}),
	)
	// Cross-run review inbox: every pending proposed update in the org, not
	// scoped to one run. Static path wins over /research/:id, like /preferences.
	.add(
		HttpApiEndpoint.get('listPendingProposals', '/research/proposed-updates', {
			query: {
				subject_table: Schema.optional(Schema.String),
				status: Schema.optional(Schema.String),
				min_confidence: Schema.optional(Schema.NumberFromString),
				machine_checkable: Schema.optional(Schema.String),
				...pageQuery,
			},
			success: PaginatedList(PendingProposal),
		}),
	)
	// Proposed update workflow
	.add(
		HttpApiEndpoint.get(
			'listProposedUpdates',
			'/research/:id/proposed-updates',
			{
				params: { id: Schema.String },
				success: Schema.Array(Schema.Unknown),
				error: NotFound.pipe(HttpApiSchema.status(404)),
			},
		),
	)
	.add(
		HttpApiEndpoint.post(
			'applyProposedUpdate',
			'/research/:id/proposed-updates/:puId/apply',
			{
				params: { id: Schema.String, puId: Schema.String },
				success: ProposedUpdateResult,
				error: NotFound.pipe(HttpApiSchema.status(404)),
			},
		),
	)
	.add(
		HttpApiEndpoint.post(
			'rejectProposedUpdate',
			'/research/:id/proposed-updates/:puId/reject',
			{
				params: { id: Schema.String, puId: Schema.String },
				success: ProposedUpdateResult,
				error: NotFound.pipe(HttpApiSchema.status(404)),
			},
		),
	)
	// Bulk apply/reject across runs — one outcome per item, so a conflict or
	// error on one proposal never aborts the others.
	.add(
		HttpApiEndpoint.post(
			'resolveProposedUpdatesBatch',
			'/research/proposed-updates/resolve',
			{
				payload: BulkResolveInput,
				success: BulkResolveResult,
			},
		),
	)
	// Policy
	.add(
		HttpApiEndpoint.get('getPolicy', '/research/preferences', {
			success: ResearchPolicy,
		}),
	)
	.add(
		HttpApiEndpoint.put('updatePolicy', '/research/policy', {
			payload: UpdatePolicyInput,
			success: ResearchPolicy,
		}),
	)
	.add(
		HttpApiEndpoint.get('spend', '/research/spend', {
			query: {
				range: Schema.optional(Schema.String),
				groupBy: Schema.optional(Schema.String),
			},
			success: Schema.Array(ResearchSpendBucket),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
