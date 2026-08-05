import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	ATTENTION_RESEARCH_STATUSES,
	TERMINAL_RESEARCH_STATUSES,
} from '@batuda/domain'

import {
	probeLimit,
	readWindowTotal,
	takePage,
	totalColumn,
} from '../lib/sql-pagination'
import {
	DEFAULT_PRIORITY_AT_LEAST,
	DEFAULT_STALE_DAYS,
	hasNoNextAction,
	isHighPriority,
	isOverdue,
	isStale,
} from './company-attention'

// The extra column `totalColumn` appends. Every list below selects it, so each
// can report how many rows matched without a second trip to the database.
type WindowTotal = { readonly total?: string | number }

// The next-steps rows carry raw Date timestamps; read them into DateTime.Utc so
// the wire schemas (NextSteps) re-encode them as ISO strings.
const NextStepTaskRow = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	type: Schema.String,
	dueAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	companyId: Schema.String,
	companyName: Schema.String,
	companySlug: Schema.String,
})
const decodeNextStepTasks = Schema.decodeUnknownEffect(
	Schema.Array(NextStepTaskRow),
)
const NextStepCompanyRow = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	status: Schema.String,
	industry: Schema.NullOr(Schema.String),
	location: Schema.NullOr(Schema.String),
	country: Schema.NullOr(Schema.String),
	priority: Schema.NullOr(Schema.Number),
	lastContactedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	nextAction: Schema.NullOr(Schema.String),
	nextActionAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
})
const decodeNextStepCompanies = Schema.decodeUnknownEffect(
	Schema.Array(NextStepCompanyRow),
)
const NextStepResearchRunRow = Schema.Struct({
	id: Schema.String,
	query: Schema.String,
	status: Schema.String,
	completedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	pendingUpdateCount: Schema.Number,
	companyId: Schema.NullOr(Schema.String),
	companyName: Schema.NullOr(Schema.String),
	companySlug: Schema.NullOr(Schema.String),
})
const decodeNextStepResearchRuns = Schema.decodeUnknownEffect(
	Schema.Array(NextStepResearchRunRow),
)

export class PipelineService extends Context.Service<PipelineService>()(
	'PipelineService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			return {
				getNextSteps: (
					limit = 20,
					options: {
						readonly staleDays?: number | undefined
						readonly priorityAtLeast?: number | undefined
					} = {},
				) =>
					Effect.gen(function* () {
						const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS
						const priorityAtLeast =
							options.priorityAtLeast ?? DEFAULT_PRIORITY_AT_LEAST

						// Every attention list draws the same company card, so they all
						// select the same columns.
						const cardColumns = sql`
							id, slug, name, status, industry, location, country, priority,
							last_contacted_at, next_action, next_action_at
						`
						// The three lists are cut so a company falls on exactly one: being
						// chased late is one thing to do about it, not three. The rules live
						// in company-attention.ts because the company list filters by the
						// same ones — a heading here that says 65 opens a list of 65 there
						// only while both are asking the same question.
						const overdue = isOverdue(sql)
						const stale = isStale(sql, staleDays)
						const hot = isHighPriority(sql, { staleDays, priorityAtLeast })

						// Each list asks to be counted as it is fetched: `COUNT(*) OVER ()`
						// is worked out before the LIMIT applies, so the full total rides
						// back on rows already being read rather than costing a query of its
						// own. A heading that says "5 of 65" needs the 65 as much as the 5.
						const withTotal = totalColumn(sql, 'exact')

						const dueTasks = yield* sql<WindowTotal>`
							SELECT t.id, t.title, t.type, t.due_at,
								t.company_id, c.name as company_name, c.slug as company_slug
								${withTotal}
							FROM tasks t
							INNER JOIN companies c
								ON t.company_id = c.id AND c.deleted_at IS NULL
							WHERE t.completed_at IS NULL
							ORDER BY t.due_at, t.id
							LIMIT ${probeLimit(limit)}
						`

						// Every ORDER BY here ends on the id. Without it two rows sharing a
						// timestamp can swap places between one read and the next, and a
						// company can slip between pages of the list it belongs to.
						const overdueCompanies = yield* sql<WindowTotal>`
							SELECT ${cardColumns}${withTotal}
							FROM companies
							WHERE ${overdue}
							ORDER BY next_action_at, id
							LIMIT ${probeLimit(limit)}
						`

						// Longest silence first: the point of the list is who has been left
						// alone the longest, and a company never contacted at all leads it.
						const staleCompanies = yield* sql<WindowTotal>`
							SELECT ${cardColumns}${withTotal}
							FROM companies
							WHERE ${stale}
							ORDER BY last_contacted_at ASC NULLS FIRST, id
							LIMIT ${probeLimit(limit)}
						`

						// Hot, and nothing booked in. Most recently touched first, so the
						// ones somebody is already thinking about come up first.
						const highPriority = yield* sql<WindowTotal>`
							SELECT ${cardColumns}${withTotal}
							FROM companies
							WHERE ${hot}
							ORDER BY updated_at DESC, id
							LIMIT ${probeLimit(limit)}
						`

						// Research a person still has to deal with: a run that wants to
						// change CRM records, or one that ended in a state asking to be
						// looked at. Someone who starts research and walks away has no
						// other way to be told it finished, so it belongs on the same
						// list as their tasks.
						const researchAwaitingReview = yield* sql<WindowTotal>`
							WITH finished AS (
								SELECT r.id, r.query, r.status, r.completed_at,
									(
										SELECT count(*)::int
										FROM jsonb_array_elements(
											CASE WHEN jsonb_typeof(r.findings->'proposed_updates') = 'array'
												THEN r.findings->'proposed_updates' ELSE '[]'::jsonb END
										) pu
										WHERE pu->>'status' = 'pending'
									) AS pending_update_count
								FROM research_runs r
								WHERE r.status IN ${sql.in(TERMINAL_RESEARCH_STATUSES)}
									-- A deleted run has ended too, but it stays hidden here as
									-- it does everywhere else.
									AND r.status != 'deleted'
							)
							SELECT f.id, f.query, f.status, f.completed_at, f.pending_update_count,
								c.id AS company_id, c.name AS company_name, c.slug AS company_slug
								${withTotal}
							FROM finished f
							-- A run can point at several companies, or at none. Take one so
							-- the run stays a single row, and keep the ones pointing at none:
							-- a freeform or scan run belongs to no single company, and those
							-- are exactly the runs nobody is watching.
							LEFT JOIN LATERAL (
								SELECT rl.subject_id
								FROM research_links rl
								WHERE rl.research_id = f.id
									AND rl.subject_table = 'companies'
									AND rl.link_kind = 'input'
								LIMIT 1
							) link ON true
							-- Filtered in the join, not the WHERE clause: a run whose company
							-- was deleted still belongs on the list, the same as a run that
							-- points at no company. Only the company's name drops off.
							LEFT JOIN companies c
								ON c.id = link.subject_id AND c.deleted_at IS NULL
							WHERE f.pending_update_count > 0
								OR f.status IN ${sql.in(ATTENTION_RESEARCH_STATUSES)}
							ORDER BY f.completed_at DESC NULLS LAST
							LIMIT ${probeLimit(limit)}
						`

						// The spare row each list asked for is dropped here; only the
						// flag saying that list was cut short leaves.
						const tasksPage = takePage(dueTasks, limit)
						const overduePage = takePage(overdueCompanies, limit)
						const stalePage = takePage(staleCompanies, limit)
						const highPriorityPage = takePage(highPriority, limit)
						const researchPage = takePage(researchAwaitingReview, limit)

						return {
							dueTasks: yield* decodeNextStepTasks(tasksPage.rows),
							overdueCompanies: yield* decodeNextStepCompanies(
								overduePage.rows,
							),
							staleCompanies: yield* decodeNextStepCompanies(stalePage.rows),
							highPriority: yield* decodeNextStepCompanies(
								highPriorityPage.rows,
							),
							researchAwaitingReview: yield* decodeNextStepResearchRuns(
								researchPage.rows,
							),
							// Read off the unsliced rows: the spare probe row carries the same
							// total, but an empty list has no row to carry one at all, which
							// the helper reports as 0 — true here, where every list starts at
							// the beginning.
							counts: {
								dueTasks: readWindowTotal(dueTasks),
								overdueCompanies: readWindowTotal(overdueCompanies),
								staleCompanies: readWindowTotal(staleCompanies),
								highPriority: readWindowTotal(highPriority),
								researchAwaitingReview: readWindowTotal(researchAwaitingReview),
							},
							dueTasksTruncated: tasksPage.hasMore,
							overdueCompaniesTruncated: overduePage.hasMore,
							staleCompaniesTruncated: stalePage.hasMore,
							highPriorityTruncated: highPriorityPage.hasMore,
							researchAwaitingReviewTruncated: researchPage.hasMore,
						}
					}),

				getPipeline: () =>
					Effect.gen(function* () {
						const counts = yield* sql<{
							status: string
							count: number
						}>`
							SELECT status, count(*)::int as count FROM companies
							WHERE deleted_at IS NULL
							GROUP BY status
						`

						const overdueTasks = yield* sql<{
							count: number
						}>`
							SELECT count(*)::int as count FROM tasks t
							WHERE t.completed_at IS NULL AND t.due_at < now()
								-- A task belonging to no company is somebody's own work and
								-- still counts; only one whose company was deleted drops out.
								AND (
									t.company_id IS NULL
									OR EXISTS (
										SELECT 1 FROM companies c
										WHERE c.id = t.company_id AND c.deleted_at IS NULL
									)
								)
						`

						// The same rule the company list filters by, so the counter and the
						// page it opens can never disagree about what "needs action" means.
						const companiesWithoutNextAction = yield* sql<{
							count: number
						}>`
							SELECT count(*)::int as count FROM companies
							WHERE ${hasNoNextAction(sql)}
						`

						return {
							statusCounts: Object.fromEntries(
								counts.map(r => [r.status, r.count]),
							),
							overdueTaskCount: overdueTasks[0]?.count ?? 0,
							companiesWithoutNextAction:
								companiesWithoutNextAction[0]?.count ?? 0,
						}
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
