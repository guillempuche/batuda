import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '../api'
import { NotFound } from '../errors'

export const DocumentsLive = HttpApiBuilder.group(
	BatudaApi,
	'documents',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						if (_.query.type) conditions.push(sql`type = ${_.query.type}`)
						return yield* sql`SELECT * FROM documents WHERE ${sql.and(conditions)}`
					}).pipe(Effect.orDie),
				)
				.handle('get', _ =>
					Effect.gen(function* () {
						const rows =
							yield* sql`SELECT * FROM documents WHERE id = ${_.params.id} LIMIT 1`
						const doc = rows[0]
						if (!doc)
							return yield* new NotFound({
								entity: 'document',
								id: _.params.id,
							})
						return doc
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const rows =
							yield* sql`INSERT INTO documents ${sql.insert(_.payload as any)} RETURNING *`
						return rows[0]
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE documents SET ${sql.update({ ...(_.payload as any), updatedAt: new Date() }, ['id'])}
							WHERE id = ${_.params.id} RETURNING *
						`
						return rows[0]
					}).pipe(Effect.orDie),
				)
		}),
)
