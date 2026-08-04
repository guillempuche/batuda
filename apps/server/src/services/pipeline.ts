import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import {
	ATTENTION_RESEARCH_STATUSES,
	TERMINAL_RESEARCH_STATUSES,
} from '@batuda/domain'

import { probeLimit, takePage } from '../lib/sql-pagination'

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
				getCounts: () =>
					sql`
						SELECT status, count(*)::int as count FROM companies
						WHERE deleted_at IS NULL
						GROUP BY status
					`,

				getOverdueTasks: (limit = 10) =>
					sql`
						SELECT t.id, t.title, t.type, t.due_at,
							t.company_id, c.name as company_name, c.slug as company_slug
						FROM tasks t
						INNER JOIN companies c
							ON t.company_id = c.id AND c.deleted_at IS NULL
						WHERE t.completed_at IS NULL AND t.due_at < now()
						ORDER BY t.due_at
						LIMIT ${limit}
					`,

				getNextSteps: (limit = 20) =>
					Effect.gen(function* () {
						const dueTasks = yield* sql`
							SELECT t.id, t.title, t.type, t.due_at,
								t.company_id, c.name as company_name, c.slug as company_slug
							FROM tasks t
							INNER JOIN companies c
								ON t.company_id = c.id AND c.deleted_at IS NULL
							WHERE t.completed_at IS NULL
							ORDER BY t.due_at
							LIMIT ${probeLimit(limit)}
						`

						const overdueCompanies = yield* sql`
							SELECT id, slug, name, next_action, next_action_at
							FROM companies
							WHERE next_action_at < now()
								AND deleted_at IS NULL
								AND status NOT IN ('closed', 'dead')
							ORDER BY next_action_at
							LIMIT ${probeLimit(limit)}
						`

						// Research a person still has to deal with: a run that wants to
						// change CRM records, or one that ended in a state asking to be
						// looked at. Someone who starts research and walks away has no
						// other way to be told it finished, so it belongs on the same
						// list as their tasks.
						const researchAwaitingReview = yield* sql`
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
						const companiesPage = takePage(overdueCompanies, limit)
						const researchPage = takePage(researchAwaitingReview, limit)

						return {
							dueTasks: yield* decodeNextStepTasks(tasksPage.rows),
							overdueCompanies: yield* decodeNextStepCompanies(
								companiesPage.rows,
							),
							researchAwaitingReview: yield* decodeNextStepResearchRuns(
								researchPage.rows,
							),
							dueTasksTruncated: tasksPage.hasMore,
							overdueCompaniesTruncated: companiesPage.hasMore,
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

						const companiesWithoutNextAction = yield* sql<{
							count: number
						}>`
							SELECT count(*)::int as count FROM companies
							WHERE next_action IS NULL
								AND deleted_at IS NULL
								AND status NOT IN ('closed', 'dead', 'client')
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
