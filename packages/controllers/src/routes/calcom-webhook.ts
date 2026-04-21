import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

export const CalcomWebhookGroup = HttpApiGroup.make('calcomWebhook').add(
	HttpApiEndpoint.post('inbound', '/webhooks/calcom', {
		payload: Schema.Unknown,
		success: Schema.Struct({ ok: Schema.Boolean }),
	}),
)
