import { Effect, Schema } from 'effect'
import { McpSchema, Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import {
	CurrentOrg,
	ResearchPolicy as ResearchPolicySchema,
	ResearchRunSummary,
	SessionContext,
} from '@batuda/controllers'
import { RESEARCH_SUBJECT_TABLES, ResearchSubjectTable } from '@batuda/domain'
import {
	ResearchService,
	resolvePolicy,
	type SystemDefaults,
} from '@batuda/research'

import { EnvVars } from '../../lib/env'
import { CompanyService } from '../../services/companies'
import { Geocoder } from '../../services/geocoder'
import { resolveResearchProposedUpdate } from '../../services/research-apply'
import { TimelineActivityService } from '../../services/timeline-activity'
import { requireApproval } from './_elicit'
import { redactDbErrors, Uuid } from './_research-shared'
import {
	ListResult,
	McpPageLimit,
	McpPageOffset,
	PageResult,
	TruncatableResult,
	toItems,
	toPage,
	toTruncatable,
} from './_result'

// McpServerClient is what lets a tool put a question to whoever is on the
// other end. Four tools here spend money, write to somebody's records, or
// delete — none of which should happen unasked — so the client belongs in
// every one of their dependency lists.
const REQUEST_DEPENDENCIES = [
	SessionContext,
	CurrentOrg,
	McpSchema.McpServerClient,
]

// What a tool answers when it could not get a person's say-so. `cancelled`
// means somebody said no; `confirmation_required` means there was nobody to
// ask, and names where a person can do it instead — a difference the caller
// has to be able to see, since one is a decision and the other is not.
const NotApproved = Schema.Struct({
	status: Schema.Literals(['cancelled', 'confirmation_required']),
	nextStep: Schema.String,
})

// Where in the app a person can do this themselves. Named here so a refusal
// can point somewhere real rather than telling the model to try again.
const RESEARCH_LIST_PAGE = '/research'
const RESEARCH_BUDGET_PAGE = 'Research budget, under organization settings'

// Put an unapproved answer into the shape the tool returns. `declined` is a
// decision and ends there; `unaskable` is not, so it says where a person can
// still do it — deliberately naming the app rather than another tool, since
// pointing the model at a tool turns the gate into a step it routes around.
const notApproved = (
	answer: 'declined' | 'unaskable',
	what: string,
	where: string,
) =>
	answer === 'declined'
		? {
				status: 'cancelled' as const,
				nextStep: `Nothing was changed — the answer was no. Ask again only if they change their mind.`,
			}
		: {
				status: 'confirmation_required' as const,
				nextStep: `This client has no way to ask anyone to ${what}, so nothing was changed. Tell whoever is reading, and they can do it from ${where}.`,
			}

// Whether this call moves any spending limit up. A cut, or a value already
// where it is, changes nothing about how much can go out unasked, so neither
// needs anybody's say-so.
//
// Compared against the limits actually in force — which fall back to the
// system defaults when nobody has set any — rather than against a stored row.
// Read from the row, somebody who had never touched their limits would find
// every change treated as a raise, including cutting one, which is the
// opposite of what the gate is for.
const raisesALimit = (
	params: {
		readonly budget_cents?: number | undefined
		readonly paid_budget_cents?: number | undefined
		readonly auto_approve_paid_cents?: number | undefined
		readonly paid_monthly_cap_cents?: number | undefined
	},
	current: {
		readonly budgetCents?: number | null
		readonly paidBudgetCents?: number | null
		readonly autoApprovePaidCents?: number | null
		readonly paidMonthlyCapCents?: number | null
	} | null,
): boolean =>
	(
		[
			[params.budget_cents, current?.budgetCents],
			[params.paid_budget_cents, current?.paidBudgetCents],
			[params.auto_approve_paid_cents, current?.autoApprovePaidCents],
			[params.paid_monthly_cap_cents, current?.paidMonthlyCapCents],
		] as const
	).some(
		([asked, held]) => asked !== undefined && (held == null || asked > held),
	)

const Decision = Schema.Literals(['approve', 'skip'])
const ProposedUpdateDecision = Schema.Literals(['apply', 'reject'])
const PolicyAction = Schema.Literals(['get', 'set'])

const ListResearch = Tool.make('list_research', {
	description:
		'List research runs in the organization, newest first. All filters are optional and combinable: subject_table + subject_id narrows to runs linked to a CRM row (companies|contacts); created_by filters by user; status filters by lifecycle state; since accepts an ISO datetime. Returns slim rows (id, kind, query, mode, schema_name, status, cost_cents, paid_cost_cents, created_by, created_at, completed_at). `hasMore` says whether more matched than were returned — read it before saying how many there are, and ask again with a larger `offset` if it is true.',
	parameters: Schema.Struct({
		created_by: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		subject_table: Schema.optional(Schema.String),
		subject_id: Schema.optional(Uuid),
		since: Schema.optional(Schema.String),
		limit: Schema.optional(McpPageLimit),
		offset: Schema.optional(McpPageOffset),
	}),
	success: PageResult(ResearchRunSummary),
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
	// The allowed subjects are read off the same list the parameter is built
	// from, so the sentence an agent reads cannot drift from what it accepts.
	description: `Post-hoc link a research run to a CRM subject (${RESEARCH_SUBJECT_TABLES.join('|')}). Inserts a finding row in research_links; re-attaching the same pair is a no-op.`,
	parameters: Schema.Struct({
		id: Schema.String,
		subject_table: ResearchSubjectTable,
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
		'Soft-delete a research run (sets status=deleted; the row stays for audit but stops appearing in list_research). Asks the person first and does nothing until they agree: {status:"cancelled"} means they said no, {status:"confirmation_required"} means this client has no way to ask them — relay nextStep rather than retrying, since retrying gives the same answer.',
	parameters: Schema.Struct({
		id: Uuid,
	}),
	success: Schema.Union([
		Schema.Struct({ status: Schema.Literal('deleted') }),
		NotApproved,
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Delete Research')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const ResolveResearchPaidAction = Tool.make('resolve_research_paid_action', {
	description:
		'Resolve a paid-action approval gate on a research run. decision=approve spawns a follow-up run that performs the paid call — money moves, so the person is asked first and nothing is spent until they agree ({status:"cancelled"} if they said no, {status:"confirmation_required"} if this client cannot ask them; relay nextStep rather than retrying). decision=skip dismisses the gate without spending and needs no approval. paid_action_id is the gate id surfaced by the run.',
	parameters: Schema.Struct({
		id: Schema.String,
		paid_action_id: Schema.String,
		decision: Decision,
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Resolve Research Paid Action')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

const ListResearchProposedUpdates = Tool.make(
	'list_research_proposed_updates',
	{
		description:
			'List proposed CRM updates surfaced by a research run. Each row is a proposal awaiting human review (apply or reject) before mutating the target table. Returns at most `limit` rows (default 100, max 500); `hasMore` says whether the run proposed more than were returned.',
		parameters: Schema.Struct({
			id: Schema.String,
			limit: Schema.optional(McpPageLimit),
		}),
		success: TruncatableResult(Schema.Unknown),
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
			'Resolve a proposed CRM update from a research run. decision=apply writes the proposed change to the target row — it changes the customer\'s own records, so the person is asked first and nothing is written until they agree ({status:"cancelled"} if they said no, {status:"confirmation_required"} if this client cannot ask them; relay nextStep rather than retrying). decision=reject discards the proposal without changing the row and needs no approval.',
		parameters: Schema.Struct({
			id: Schema.String,
			proposed_update_id: Schema.String,
			decision: ProposedUpdateDecision,
		}),
		success: Schema.Unknown,
		dependencies: REQUEST_DEPENDENCIES,
	},
)
	.annotate(Tool.Title, 'Resolve Research Proposed Update')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.OpenWorld, false)

const ResearchPolicy = Tool.make('research_policy', {
	description:
		'Get or update research budget limits. action=get returns the active limits: three per-run limits belonging to the calling user (free budget, paid budget, paid-action auto-approve threshold) plus paid_monthly_cap_cents, which is the ORGANIZATION\'s ceiling on paid research spend for the calendar month and applies to everyone in it. action=set upserts the provided fields; unspecified fields keep their current value. Cents-denominated. Raising any limit lets more money be spent without anyone being asked, so the person is asked before a raise takes effect ({status:"cancelled"} if they said no, {status:"confirmation_required"} if this client has no way to ask them — relay nextStep rather than retrying). Lowering a limit, or leaving it where it is, needs no approval.',
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
		NotApproved,
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
		const env = yield* EnvVars

		// What the limits are when nobody has set any, so "is this a raise?"
		// compares against the figures actually in force rather than treating a
		// first-time change as one.
		const systemDefaults: SystemDefaults = {
			budgetCents: env.RESEARCH_DEFAULT_BUDGET_CENTS,
			paidBudgetCents: env.RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
			autoApprovePaidCents: env.RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
			paidMonthlyCapCents: env.RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
			hardCeiling: env.RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
		}
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
					.pipe(redactDbErrors, Effect.map(toPage)),
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
					const answer = yield* requireApproval(
						`Delete research run ${id}? It stops appearing in the research list.`,
					)
					if (answer !== 'confirmed')
						return notApproved(answer, 'delete this run', RESEARCH_LIST_PAGE)
					yield* svc.softDelete(id)
					return { status: 'deleted' as const }
				}).pipe(redactDbErrors),
			resolve_research_paid_action: ({ id, paid_action_id, decision }) =>
				Effect.gen(function* () {
					// Skipping spends nothing and needs nobody's say-so; approving
					// buys the data, so it does.
					if (decision === 'approve') {
						const answer = yield* requireApproval(
							`Approve the paid lookup waiting on research run ${id}? This spends money from the organization's research budget.`,
						)
						if (answer !== 'confirmed')
							return notApproved(
								answer,
								'approve this spending',
								RESEARCH_LIST_PAGE,
							)
						const { userId } = yield* SessionContext
						return yield* svc.approvePaidAction(id, paid_action_id, userId)
					}
					return yield* svc.skipPaidAction(id, paid_action_id)
				}).pipe(redactDbErrors),
			list_research_proposed_updates: ({ id, limit }) =>
				Effect.gen(function* () {
					const run = yield* svc.get(id)
					if (!run) return { items: [], hasMore: false }
					const findings = (run as { findings: unknown }).findings as {
						proposed_updates?: unknown[]
					} | null
					const proposedUpdates = findings?.proposed_updates ?? []
					return toTruncatable(proposedUpdates, limit ?? 100)
				}).pipe(redactDbErrors),
			resolve_research_proposed_update: ({
				id,
				proposed_update_id,
				decision,
			}) =>
				Effect.gen(function* () {
					// Rejecting changes nothing; applying writes to the customer's own
					// records, so that is what gets asked about.
					if (decision === 'apply') {
						const answer = yield* requireApproval(
							`Apply the proposed change from research run ${id} to your CRM records?`,
						)
						if (answer !== 'confirmed')
							return notApproved(
								answer,
								'apply this change',
								`${RESEARCH_LIST_PAGE}/${id}`,
							)
					}
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
					const org = yield* CurrentOrg
					if (params.action === 'get') {
						const policy = yield* svc.getPolicy(userId, org.id)
						// A missing policy row must still come back as an object — the
						// MCP contract rejects a bare `null` as structured output.
						return { policy: policy ?? null }
					}
					// Raising a limit is what lets more money go out without anybody
					// being asked, so a raise is asked about and a cut is not. Left
					// ungated, this tool would undo every other gate here: hit one,
					// raise the limit, ask again.
					// The three per-run limits are this person's; the monthly ceiling
					// is the organization's and lives elsewhere, so it is read where
					// it actually is. Taken from the person's row instead, an
					// organization that had set a low ceiling would read as the
					// system default here, and raising it towards that default would
					// slip through as a cut.
					const mine = yield* resolvePolicy({ sql, userId, systemDefaults })
					const [orgPolicy] = yield* sql<{ paidMonthlyCapCents: number }>`
						SELECT paid_monthly_cap_cents
						FROM organization_research_policy
						WHERE organization_id = ${org.id}
					`
					const current = {
						...mine,
						paidMonthlyCapCents:
							orgPolicy?.paidMonthlyCapCents ??
							systemDefaults.paidMonthlyCapCents,
					}
					if (raisesALimit(params, current)) {
						const answer = yield* requireApproval(
							`Raise a research spending limit for ${org.name}? More could then be spent without anyone being asked.`,
						)
						if (answer !== 'confirmed')
							return notApproved(
								answer,
								'raise this limit',
								RESEARCH_BUDGET_PAGE,
							)
					}
					return yield* svc.updatePolicy(userId, org.id, {
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
