import { Schema } from 'effect'

export class NotFound extends Schema.TaggedErrorClass<NotFound>()('NotFound', {
	entity: Schema.String,
	id: Schema.String,
}) {}

export class BadRequest extends Schema.TaggedErrorClass<BadRequest>()(
	'BadRequest',
	{ message: Schema.String },
) {}

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
	'Unauthorized',
	{ message: Schema.String },
) {}
