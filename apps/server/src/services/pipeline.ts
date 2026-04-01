import { Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export class PipelineService extends ServiceMap.Service<PipelineService>()(
	'PipelineService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			return {
				getCounts: () =>
					sql`SELECT status, count(*)::int as count FROM companies GROUP BY status`,

				getOverdueTasks: (limit = 10) =>
					sql`
						SELECT t.id, t.title, t.type, t.due_at,
							t.company_id, c.name as company_name, c.slug as company_slug
						FROM tasks t
						INNER JOIN companies c ON t.company_id = c.id
						WHERE t.completed_at IS NULL AND t.due_at < ${new Date()}
						ORDER BY t.due_at
						LIMIT ${limit}
					`,

				getNextSteps: (limit = 20) =>
					Effect.gen(function* () {
						const dueTasks = yield* sql`
							SELECT t.id, t.title, t.type, t.due_at,
								t.company_id, c.name as company_name, c.slug as company_slug
							FROM tasks t
							INNER JOIN companies c ON t.company_id = c.id
							WHERE t.completed_at IS NULL
							ORDER BY t.due_at
							LIMIT ${limit}
						`

						const overdueCompanies = yield* sql`
							SELECT id, slug, name, next_action, next_action_at
							FROM companies
							WHERE next_action_at < ${new Date()}
								AND status NOT IN ('closed', 'dead')
							ORDER BY next_action_at
							LIMIT ${limit}
						`

						return { dueTasks, overdueCompanies }
					}),

				getPipeline: () =>
					Effect.gen(function* () {
						const counts = yield* sql<{
							status: string
							count: number
						}>`SELECT status, count(*)::int as count FROM companies GROUP BY status`

						const overdueTasks = yield* sql<{
							count: number
						}>`
							SELECT count(*)::int as count FROM tasks
							WHERE completed_at IS NULL AND due_at < ${new Date()}
						`

						const companiesWithoutNextAction = yield* sql<{
							count: number
						}>`
							SELECT count(*)::int as count FROM companies
							WHERE next_action IS NULL
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
