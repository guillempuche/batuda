import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'
import { Product } from '@batuda/domain'

import { ProductIdParam } from './_ids'
import { McpPageLimit, TruncatableResult, toTruncatable } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg]

const decodeProduct = Schema.decodeUnknownEffect(Product)
const decodeProducts = Schema.decodeUnknownEffect(Schema.Array(Product))

const ListProducts = Tool.make('list_products', {
	description:
		'List products in the organization, newest first. Each item is the full product record (default_price is a decimal string). Returns at most `limit` rows (default 100, max 500); `hasMore` says whether more exist than were returned.',
	parameters: Schema.Struct({
		limit: Schema.optionalKey(McpPageLimit),
	}),
	success: TruncatableResult(Product.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Products')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateProduct = Tool.make('create_product', {
	description:
		'Create a product. slug is org-unique (lowercase letters, digits, hyphens). type and status are free-form labels (e.g. service|software|subscription, active|archived). default_price is decimal stringified; price_type defaults to "fixed".',
	parameters: Schema.Struct({
		slug: Schema.String,
		name: Schema.String,
		type: Schema.String,
		status: Schema.optionalKey(Schema.String),
		description: Schema.optionalKey(Schema.String),
		default_price: Schema.optionalKey(Schema.String),
		price_type: Schema.optionalKey(Schema.String),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Product.json,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Product')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateProduct = Tool.make('update_product', {
	description:
		'Update fields on an existing product by id. Only the fields you pass are changed; org-scope is enforced by RLS.',
	parameters: Schema.Struct({
		id: ProductIdParam,
		name: Schema.optionalKey(Schema.String),
		type: Schema.optionalKey(Schema.String),
		status: Schema.optionalKey(Schema.String),
		description: Schema.optionalKey(Schema.String),
		default_price: Schema.optionalKey(Schema.String),
		price_type: Schema.optionalKey(Schema.String),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.NullOr(Product.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Product')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const ProductTools = Toolkit.make(
	ListProducts,
	CreateProduct,
	UpdateProduct,
)

export const ProductHandlersLive = ProductTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			list_products: params =>
				Effect.gen(function* () {
					const limit = params.limit ?? 100
					const rows = yield* sql`
						SELECT * FROM products
						ORDER BY created_at DESC
						LIMIT ${limit + 1}
					`
					return toTruncatable(yield* decodeProducts(rows), limit)
				}).pipe(Effect.orDie),
			create_product: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const row: Record<string, unknown> = {
						organizationId: currentOrg.id,
						slug: params.slug,
						name: params.name,
						type: params.type,
					}
					if (params.status !== undefined) row['status'] = params.status
					if (params.description !== undefined)
						row['description'] = params.description
					if (params.default_price !== undefined)
						row['defaultPrice'] = params.default_price
					if (params.price_type !== undefined)
						row['priceType'] = params.price_type
					if (params.metadata !== undefined) row['metadata'] = params.metadata
					const rows =
						yield* sql`INSERT INTO products ${sql.insert(row)} RETURNING *`
					const created = rows[0]
					if (created === undefined)
						return yield* Effect.die(
							new Error('product insert returned no row'),
						)
					return yield* decodeProduct(created)
				}).pipe(Effect.orDie),
			update_product: ({ id, ...rest }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}
					if (rest.name !== undefined) data['name'] = rest.name
					if (rest.type !== undefined) data['type'] = rest.type
					if (rest.status !== undefined) data['status'] = rest.status
					if (rest.description !== undefined)
						data['description'] = rest.description
					if (rest.default_price !== undefined)
						data['defaultPrice'] = rest.default_price
					if (rest.price_type !== undefined) data['priceType'] = rest.price_type
					if (rest.metadata !== undefined) data['metadata'] = rest.metadata
					const rows = yield* sql`
						UPDATE products SET ${sql.update(data, ['id'])}
						WHERE id = ${id} RETURNING *
					`
					const row = rows[0]
					return row === undefined ? null : yield* decodeProduct(row)
				}).pipe(Effect.orDie),
		}
	}),
)
