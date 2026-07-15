import { DateTime, Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg } from '@batuda/controllers'
import { Product } from '@batuda/domain'

const decodeProduct = Schema.decodeUnknownEffect(Product)
const decodeProducts = Schema.decodeUnknownEffect(Schema.Array(Product))

export const ProductsLive = HttpApiBuilder.group(
	BatudaApi,
	'products',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', () =>
					Effect.gen(function* () {
						const rows = yield* sql`SELECT * FROM products`
						return yield* decodeProducts(rows)
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const rows = yield* sql`INSERT INTO products ${sql.insert({
							..._.payload,
							organizationId: currentOrg.id,
						})} RETURNING *`
						yield* Effect.logInfo('Product created').pipe(
							Effect.annotateLogs({ event: 'product.created' }),
						)
						const created = rows[0]
						if (created === undefined)
							return yield* Effect.die(
								new Error('product insert returned no row'),
							)
						return yield* decodeProduct(created)
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE products SET ${sql.update({ ..._.payload, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })}
							WHERE id = ${_.params.id} RETURNING *
						`
						yield* Effect.logInfo('Product updated').pipe(
							Effect.annotateLogs({
								event: 'product.updated',
								productId: _.params.id,
							}),
						)
						const row = rows[0]
						return row === undefined ? null : yield* decodeProduct(row)
					}).pipe(Effect.orDie),
				)
		}),
)
