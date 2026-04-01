import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const ApiKeyId = Schema.String.pipe(Schema.brand('ApiKeyId'))

export class ApiKey extends Model.Class<ApiKey>('ApiKey')({
	id: Model.Generated(ApiKeyId),
	name: Schema.String,
	// e.g. "n8n local", "zapier prod", "claude-code"
	keyHash: Schema.String,
	scopes: Schema.Array(Schema.String),
	// e.g. ["read:companies", "write:interactions", "write:tasks"]
	isActive: Schema.Boolean,
	lastUsedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	expiresAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	createdAt: Model.DateTimeInsertFromDate,
}) {}
