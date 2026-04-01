import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ProductId = Schema.String.pipe(Schema.brand('ProductId'))

export class Product extends Model.Class<Product>('Product')({
	id: Model.Generated(ProductId),
	slug: Schema.String,
	name: Schema.String,

	type: Schema.String,
	// values: service | product | microsaas
	status: Schema.String,
	// values: active | beta | idea

	description: Schema.NullOr(Schema.String),
	defaultPrice: Schema.NullOr(Schema.String),
	// numeric returns string from PG
	priceType: Schema.NullOr(Schema.String),
	// values: fixed | monthly | custom

	targetIndustries: Schema.NullOr(Schema.Array(Schema.String)),
	metadata: Schema.NullOr(Schema.Unknown),

	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeUpdateFromDate,
}) {}
