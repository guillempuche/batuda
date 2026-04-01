import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '../api'

export const TasksLive = HttpApiBuilder.group(BatudaApi, 'tasks', handlers =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return handlers
			.handle('list', _ =>
				Effect.gen(function* () {
					const conditions: Array<Statement.Fragment> = []
					if (_.query.companyId)
						conditions.push(sql`company_id = ${_.query.companyId}`)
					if (_.query.completed === 'true')
						conditions.push(sql`completed_at IS NOT NULL`)
					else if (_.query.completed === 'false')
						conditions.push(sql`completed_at IS NULL`)

					return yield* sql`
							SELECT * FROM tasks
							WHERE ${sql.and(conditions)}
							ORDER BY due_at
						`
				}).pipe(Effect.orDie),
			)
			.handle('create', _ =>
				Effect.gen(function* () {
					const rows =
						yield* sql`INSERT INTO tasks ${sql.insert(_.payload as any)} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
			)
			.handle('complete', _ =>
				Effect.gen(function* () {
					const rows = yield* sql`
							UPDATE tasks SET completed_at = now()
							WHERE id = ${_.params.id} RETURNING *
						`
					return rows[0]
				}).pipe(Effect.orDie),
			)
	}),
)
