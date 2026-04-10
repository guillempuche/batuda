import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { ForjaApi } from '@engranatge/controllers'

export const ProductsLive = HttpApiBuilder.group(
	ForjaApi,
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
						yield* Effect.logInfo('Product created').pipe(
							Effect.annotateLogs({ event: 'product.created' }),
						)
						return rows[0]
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE products SET ${sql.update({ ...(_.payload as any), updatedAt: new Date() }, ['id'])}
							WHERE id = ${_.params.id} RETURNING *
						`
						yield* Effect.logInfo('Product updated').pipe(
							Effect.annotateLogs({
								event: 'product.updated',
								productId: _.params.id,
							}),
						)
						return rows[0]
					}).pipe(Effect.orDie),
				)
		}),
)
