import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi } from '../api'

export const ProductsLive = HttpApiBuilder.group(
	BatudaApi,
	'products',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', () =>
					Effect.gen(function* () {
						return yield* sql`SELECT * FROM products`
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const rows =
							yield* sql`INSERT INTO products ${sql.insert(_.payload as any)} RETURNING *`
						return rows[0]
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE products SET ${sql.update({ ...(_.payload as any), updatedAt: new Date() }, ['id'])}
							WHERE id = ${_.params.id} RETURNING *
						`
						return rows[0]
					}).pipe(Effect.orDie),
				)
		}),
)
