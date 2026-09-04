import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { ResearchSubjectTable } from '@batuda/domain'
// Straight from the schemas file rather than the package entry point: that entry
// point also reaches the research service and the providers it talks to, and this
// spec is what the browser builds its API client from.
import { SchemaNameSchema } from '@batuda/research/application/schemas'

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
	ResearchPolicy,
	ResearchRunDetail,
	ResearchRunLive,
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
	// The country as a code, and the place in words. Two fields because they answer
	// two questions: a code can be matched against a company's own country and sets
	// the search provider's locale, while a place is prose for the searcher to read.
	// One field doing both is how "MD" for Baltimore became Moldova and dropped
	// every US company a scan found.
	country: Schema.optional(Schema.String),
	place: Schema.optional(Schema.String),
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
	// The two things the engine writes into a run's own stored context: the web
	// address a rerun is pinned to, and the paid step a follow-up run was spawned
	// to carry out. Both have to be shapes the check below accepts, or a caller
	// that reads a run and sends its context back is refused a value it never
	// wrote. Spelled as the engine spells them, because renaming one would strip
	// the field off every run already on file.
	anchorDomain: Schema.optional(Schema.String),
	paid_action: Schema.optional(
		Schema.Struct({
			tool: Schema.optional(Schema.String),
			args: Schema.optional(Schema.Unknown),
			origin_run_id: Schema.optional(Schema.String),
			action_id: Schema.optional(Schema.String),
		}),
	),
})

// Exported for the test next door, which pins schema_name to the closed set —
// widening it back to a bare string is what let a doomed run be created.
export const CreateResearchInput = Schema.Struct({
	query: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	mode: Schema.optional(Schema.String),
	context: Schema.optional(ContextInput),
	// The closed set, not a bare string: an unknown name is refused as a bad
	// request before the handler runs, so nothing is written. A selector request
	// would otherwise write a batch row and one run per matched company, every
	// one of them doomed.
	schema_name: Schema.optional(SchemaNameSchema),
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
				// A run named a company or contact this organization cannot see.
				NotFound.pipe(HttpApiSchema.status(404)),
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
	// GET /research/:id/live — server-sent events, one frame per change, held
	// open until the run ends. Each frame is the whole of where the run is, so
	// the page never has to fetch anything alongside it to stay current.
	.add(
		HttpApiEndpoint.get('live', '/research/:id/live', {
			params: { id: Schema.String },
			success: HttpApiSchema.StreamSse({ data: ResearchRunLive }),
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
				query: { ...pageQuery },
				success: PaginatedList(Schema.Unknown),
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
