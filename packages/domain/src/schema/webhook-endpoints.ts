import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const WebhookEndpointId = Schema.String.pipe(
	Schema.brand('WebhookEndpointId'),
)

export class WebhookEndpoint extends Model.Class<WebhookEndpoint>(
	'WebhookEndpoint',
)({
	id: Model.Generated(WebhookEndpointId),
	name: Schema.String,
	// e.g. "n8n company created", "zapier proposal accepted"
	url: Schema.String,
	events: Schema.Array(Schema.String),
	// e.g. ["company.status_changed", "interaction.logged",
	//        "proposal.accepted", "task.due"]
	secret: Schema.NullOr(Schema.String),
	// HMAC-SHA256 signing secret
	isActive: Schema.Boolean,
	lastTriggeredAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	createdAt: Model.DateTimeInsertFromDate,
}) {}
