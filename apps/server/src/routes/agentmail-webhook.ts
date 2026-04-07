import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

export const AgentMailWebhookGroup = HttpApiGroup.make('agentmailWebhook').add(
	HttpApiEndpoint.post('inbound', '/webhooks/agentmail/inbound', {
		payload: Schema.Unknown,
		success: Schema.Struct({ ok: Schema.Boolean }),
	}),
)
