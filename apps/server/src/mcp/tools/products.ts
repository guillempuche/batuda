import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg]

const ListProducts = Tool.make('list_products', {
	description:
		'List products in the organization. Returns id, slug, name, type, status, default_price, price_type, target_industries, metadata, created_at.',
	success: ListResult(Schema.Unknown),
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
		status: Schema.optional(Schema.String),
		description: Schema.optional(Schema.String),
		default_price: Schema.optional(Schema.String),
		price_type: Schema.optional(Schema.String),
		target_industries: Schema.optional(Schema.Array(Schema.String)),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Product')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateProduct = Tool.make('update_product', {
	description:
		'Update fields on an existing product by id. Only the fields you pass are changed; org-scope is enforced by RLS.',
	parameters: Schema.Struct({
		id: Schema.String,
		name: Schema.optional(Schema.String),
		type: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		description: Schema.optional(Schema.String),
		default_price: Schema.optional(Schema.String),
		price_type: Schema.optional(Schema.String),
		target_industries: Schema.optional(Schema.Array(Schema.String)),
		metadata: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
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
			list_products: () =>
				sql`SELECT id, slug, name, type, status, default_price, price_type, target_industries, metadata, created_at FROM products ORDER BY created_at DESC`.pipe(
					Effect.orDie,
					Effect.map(toItems),
				),
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
					if (params.target_industries !== undefined)
						row['targetIndustries'] = params.target_industries
					if (params.metadata !== undefined) row['metadata'] = params.metadata
					const rows =
						yield* sql`INSERT INTO products ${sql.insert(row)} RETURNING *`
					return rows[0]
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
					if (rest.target_industries !== undefined)
						data['targetIndustries'] = rest.target_industries
					if (rest.metadata !== undefined) data['metadata'] = rest.metadata
					const rows = yield* sql`
						UPDATE products SET ${sql.update(data, ['id'])}
						WHERE id = ${id} RETURNING *
					`
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
