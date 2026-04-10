import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { SessionMiddleware } from '../middleware/session'

const CreateProductInput = Schema.Struct({
	slug: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]+$/))),
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	type: Schema.String,
	status: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	defaultPrice: Schema.optional(Schema.String),
	priceType: Schema.optional(Schema.String),
	targetIndustries: Schema.optional(Schema.Array(Schema.String)),
	metadata: Schema.optional(Schema.Unknown),
})

const UpdateProductInput = Schema.Struct({
	name: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	defaultPrice: Schema.optional(Schema.String),
	priceType: Schema.optional(Schema.String),
	targetIndustries: Schema.optional(Schema.Array(Schema.String)),
	metadata: Schema.optional(Schema.Unknown),
})

export const ProductsGroup = HttpApiGroup.make('products')
	.add(
		HttpApiEndpoint.get('list', '/products', {
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/products', {
			payload: CreateProductInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/products/:id', {
			params: { id: Schema.String },
			payload: UpdateProductInput,
			success: Schema.Unknown,
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
