import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

const CreateWebhookInput = Schema.Struct({
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	url: Schema.String,
	events: Schema.Array(Schema.String),
	secret: Schema.optional(Schema.String),
})

const UpdateWebhookInput = Schema.Struct({
	name: Schema.optional(Schema.String),
	url: Schema.optional(Schema.String),
	events: Schema.optional(Schema.Array(Schema.String)),
	secret: Schema.optional(Schema.String),
	isActive: Schema.optional(Schema.Boolean),
})

export const WebhooksGroup = HttpApiGroup.make('webhooks')
	.add(
		HttpApiEndpoint.get('list', '/webhooks', {
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/webhooks', {
			payload: CreateWebhookInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/webhooks/:id', {
			params: { id: Schema.String },
			payload: UpdateWebhookInput,
			success: Schema.Unknown,
		}),
	)
	.add(
		HttpApiEndpoint.delete('remove', '/webhooks/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
		}),
	)
	.add(
		HttpApiEndpoint.post('test', '/webhooks/:id/test', {
			params: { id: Schema.String },
			success: Schema.Void,
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
