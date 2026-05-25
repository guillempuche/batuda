import { Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

// Persistence shared by the HTTP `tasks` handler and the MCP task toolkit.
// Both write paths funnel through here so the `organization_id` stamp lives
// in one place: the column is NOT NULL with no DB default, and the
// org_isolation RLS policy's WITH CHECK rejects any row whose
// organization_id doesn't match the active org GUC.
export class TaskService extends ServiceMap.Service<TaskService>()(
	'TaskService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			return {
				create: (data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`INSERT INTO tasks ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
