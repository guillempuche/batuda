import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

import { WebhookEndpoint } from '@batuda/domain'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'
import { UuidParam } from '../uuid-param'

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
			success: Schema.Array(WebhookEndpoint.json),
		}),
	)
	.add(
		HttpApiEndpoint.post('create', '/webhooks', {
			payload: CreateWebhookInput,
			success: WebhookEndpoint.json,
		}),
	)
	.add(
		HttpApiEndpoint.patch('update', '/webhooks/:id', {
			params: { id: UuidParam },
			payload: UpdateWebhookInput,
			success: WebhookEndpoint.json,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.delete('remove', '/webhooks/:id', {
			params: { id: UuidParam },
			success: Schema.Void,
		}),
	)
	.add(
		HttpApiEndpoint.post('test', '/webhooks/:id/test', {
			params: { id: UuidParam },
			success: Schema.Void,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
