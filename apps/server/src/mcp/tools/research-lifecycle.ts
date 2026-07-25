import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import {
	CurrentOrg,
	ResearchPolicy as ResearchPolicySchema,
	ResearchRunSummary,
	SessionContext,
} from '@batuda/controllers'
import { ResearchService } from '@batuda/research'

import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { resolveResearchProposedUpdate } from '../../services/research-apply'
import { TimelineActivityService } from '../../services/timeline-activity'
import { redactDbErrors, Uuid } from './_research-shared'
import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]

const Decision = Schema.Literals(['approve', 'skip'])
const ProposedUpdateDecision = Schema.Literals(['apply', 'reject'])
const PolicyAction = Schema.Literals(['get', 'set'])

const ListResearch = Tool.make('list_research', {
	description:
		'List research runs in the organization, newest first. All filters are optional and combinable: subject_table + subject_id narrows to runs linked to a CRM row (companies|contacts); created_by filters by user; status filters by lifecycle state; since accepts an ISO datetime. Returns slim rows (id, kind, query, mode, schema_name, status, cost_cents, paid_cost_cents, created_by, created_at, completed_at).',
	parameters: Schema.Struct({
		created_by: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		subject_table: Schema.optional(Schema.String),
		subject_id: Schema.optional(Uuid),
		since: Schema.optional(Schema.String),
		limit: Schema.optional(Schema.Number),
		offset: Schema.optional(Schema.Number),
	}),
	success: ListResult(ResearchRunSummary),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Research')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CancelResearch = Tool.make('cancel_research', {
	description:
		'Interrupt a queued or running research run. Already-cancelled runs are left as-is.',
	parameters: Schema.Struct({
		id: Uuid,
	}),
	success: Schema.Union([
		Schema.Struct({ status: Schema.Literal('cancelled') }),
		Schema.Struct({ error: Schema.Literal('not_found') }),
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Cancel Research')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const AttachResearch = Tool.make('attach_research', {
	description:
		'Post-hoc link a research run to a CRM subject (companies|contacts). Inserts a finding row in research_links; re-attaching the same pair is a no-op.',
	parameters: Schema.Struct({
		id: Schema.String,
		subject_table: Schema.Literals(['companies', 'contacts']),
		subject_id: Uuid,
	}),
	success: Schema.Union([
		Schema.Struct({ status: Schema.Literal('attached') }),
		Schema.Struct({
			error: Schema.Literals(['subject_not_found', 'run_not_found']),
		}),
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Attach Research')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const DeleteResearch = Tool.make('delete_research', {
	description:
		'Soft-delete a research run (sets status=deleted; the row stays for audit but stops appearing in list_research). Requires user approval before execution.',
	parameters: Schema.Struct({
		id: Uuid,
	}),
	success: Schema.Struct({
		status: Schema.Literal('deleted'),
	}),
	dependencies: REQUEST_DEPENDENCIES,
	needsApproval: true,
})
	.annotate(Tool.Title, 'Delete Research')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const ResolveResearchPaidAction = Tool.make('resolve_research_paid_action', {
	description:
		'Resolve a paid-action approval gate on a research run. decision=approve spawns a follow-up run that performs the paid call (and requires user approval, since money moves); decision=skip dismisses the gate without spending. paid_action_id is the gate id surfaced by the run.',
	parameters: Schema.Struct({
		id: Schema.String,
		paid_action_id: Schema.String,
		decision: Decision,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
	needsApproval: params => params.decision === 'approve',
})
	.annotate(Tool.Title, 'Resolve Research Paid Action')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ListResearchProposedUpdates = Tool.make(
	'list_research_proposed_updates',
	{
		description:
			'List proposed CRM updates surfaced by a research run. Each row is a proposal awaiting human review (apply or reject) before mutating the target table.',
		parameters: Schema.Struct({
			id: Schema.String,
		}),
		success: ListResult(Schema.Unknown),
		dependencies: REQUEST_DEPENDENCIES,
	},
)
	.annotate(Tool.Title, 'List Research Proposed Updates')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ResolveResearchProposedUpdate = Tool.make(
	'resolve_research_proposed_update',
	{
		description:
			'Resolve a proposed CRM update from a research run. decision=apply writes the proposed change to the target row (requires user approval, since it mutates CRM data); decision=reject discards the proposal without changing the row.',
		parameters: Schema.Struct({
			id: Schema.String,
			proposed_update_id: Schema.String,
			decision: ProposedUpdateDecision,
		}),
		success: Schema.Unknown,
		dependencies: REQUEST_DEPENDENCIES,
		needsApproval: params => params.decision === 'apply',
	},
)
	.annotate(Tool.Title, 'Resolve Research Proposed Update')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const ResearchPolicy = Tool.make('research_policy', {
	description:
		"Get or update the calling user's research budget policy. action=get returns the active limits (per-run free budget, per-run paid budget, paid-action auto-approve threshold, monthly paid cap) or system defaults if none set. action=set upserts the provided fields; unspecified fields keep their current value at the DB level (or default if no row exists). Cents-denominated.",
	parameters: Schema.Struct({
		action: PolicyAction,
		budget_cents: Schema.optional(Schema.Number),
		paid_budget_cents: Schema.optional(Schema.Number),
		auto_approve_paid_cents: Schema.optional(Schema.Number),
		paid_monthly_cap_cents: Schema.optional(Schema.Number),
	}),
	// get → the policy wrapped in an object (a bare null isn't valid MCP output);
	// set → the upserted policy directly.
	success: Schema.Union([
		Schema.Struct({ policy: Schema.NullOr(ResearchPolicySchema) }),
		ResearchPolicySchema,
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Research Policy')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const SpendRange = Schema.Literals(['month', '30d', 'all'])
const SpendGroupBy = Schema.Literals(['provider', 'user', 'tool'])

const GetResearchSpend = Tool.make('get_research_spend', {
	description:
		'Aggregate research paid spending for the organization. range defaults to "all" (also accepts "month" for current calendar month, "30d" for last 30 days); group_by defaults to "provider" (also accepts "user", "tool"). Returns rows of {key, amount_cents, calls} sorted by amount_cents desc.',
	parameters: Schema.Struct({
		range: Schema.optional(SpendRange),
		group_by: Schema.optional(SpendGroupBy),
	}),
	success: ListResult(Schema.Unknown),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Research Spend')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const ResearchLifecycleTools = Toolkit.make(
	ListResearch,
	CancelResearch,
	AttachResearch,
	DeleteResearch,
	ResolveResearchPaidAction,
	ListResearchProposedUpdates,
	ResolveResearchProposedUpdate,
	ResearchPolicy,
	GetResearchSpend,
)

export const ResearchLifecycleHandlersLive = ResearchLifecycleTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* ResearchService
		// The apply path writes a CRM row and, on a location change, forks an
		// org-scoped re-geocode — resolve those services here and provide them,
		// keeping CurrentOrg as the only per-request service the handler needs.
		const companyService = yield* CompanyService
		const geocoder = yield* Geocoder
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return {
			list_research: filters =>
				svc
					.list({
						createdBy: filters.created_by,
						status: filters.status,
						subjectTable: filters.subject_table,
						subjectId: filters.subject_id,
						since: filters.since,
						limit: filters.limit,
						offset: filters.offset,
					})
					.pipe(
						redactDbErrors,
						Effect.map(page => toItems(page.items)),
					),
			cancel_research: ({ id }) =>
				Effect.gen(function* () {
					const res = yield* svc.cancel(id)
					if (res.outcome === 'not_found')
						return { error: 'not_found' as const }
					return { status: 'cancelled' as const }
				}).pipe(redactDbErrors),
			attach_research: ({ id, subject_table, subject_id }) =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const res = yield* svc.attach(
						currentOrg.id,
						id,
						subject_table,
						subject_id,
					)
					if (res.outcome === 'attached') return { status: 'attached' as const }
					return { error: res.outcome }
				}).pipe(redactDbErrors),
			delete_research: ({ id }) =>
				Effect.gen(function* () {
					yield* svc.softDelete(id)
					return { status: 'deleted' as const }
				}).pipe(redactDbErrors),
			resolve_research_paid_action: ({ id, paid_action_id, decision }) =>
				Effect.gen(function* () {
					if (decision === 'approve') {
						const { userId } = yield* SessionContext
						return yield* svc.approvePaidAction(id, paid_action_id, userId)
					}
					return yield* svc.skipPaidAction(id, paid_action_id)
				}).pipe(redactDbErrors),
			list_research_proposed_updates: ({ id }) =>
				Effect.gen(function* () {
					const run = yield* svc.get(id)
					if (!run) return []
					const findings = (run as { findings: unknown }).findings as {
						proposed_updates?: unknown[]
					} | null
					return findings?.proposed_updates ?? []
				}).pipe(redactDbErrors, Effect.map(toItems)),
			resolve_research_proposed_update: ({
				id,
				proposed_update_id,
				decision,
			}) =>
				Effect.gen(function* () {
					const { userId } = yield* SessionContext
					return yield* resolveResearchProposedUpdate(
						id,
						proposed_update_id,
						decision,
						userId,
					).pipe(
						Effect.provideService(CompanyService, companyService),
						Effect.provideService(Geocoder, geocoder),
						Effect.provideService(SqlClient.SqlClient, sql),
						Effect.provideService(TimelineActivityService, timeline),
					)
				}).pipe(redactDbErrors),
			research_policy: params =>
				Effect.gen(function* () {
					const { userId } = yield* SessionContext
					if (params.action === 'get') {
						const policy = yield* svc.getPolicy(userId)
						// A missing policy row must still come back as an object — the
						// MCP contract rejects a bare `null` as structured output.
						return { policy: policy ?? null }
					}
					return yield* svc.updatePolicy(userId, {
						budgetCents: params.budget_cents,
						paidBudgetCents: params.paid_budget_cents,
						autoApprovePaidCents: params.auto_approve_paid_cents,
						paidMonthlyCapCents: params.paid_monthly_cap_cents,
					})
				}).pipe(redactDbErrors),
			get_research_spend: ({ range, group_by }) =>
				svc
					.spend({
						// Conditional spread — exactOptionalPropertyTypes rejects
						// passing `undefined` explicitly for these optional fields.
						...(range !== undefined && { range }),
						...(group_by !== undefined && { groupBy: group_by }),
					})
					.pipe(redactDbErrors, Effect.map(toItems)),
		}
	}),
)
