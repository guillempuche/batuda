import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// ── Input ──

export const CreateApiKeyInput = Schema.Struct({
	name: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	// Optional TTL in days; omitted ⇒ a non-expiring key.
	expiresInDays: Schema.optional(
		Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))),
	),
})

// ── Views ──

// Redacted — never carries the secret, only the masked `start` prefix BA stores.
export const ApiKeyView = Schema.Struct({
	id: Schema.String,
	name: Schema.NullOr(Schema.String),
	start: Schema.NullOr(Schema.String),
	prefix: Schema.NullOr(Schema.String),
	expiresAt: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	enabled: Schema.Boolean,
	createdBy: Schema.NullOr(
		Schema.Struct({
			id: Schema.String,
			name: Schema.NullOr(Schema.String),
			email: Schema.String,
		}),
	),
})

// Create response — the only place the plaintext `key` is ever returned.
export const CreatedApiKeyView = Schema.Struct({
	id: Schema.String,
	key: Schema.String,
	name: Schema.NullOr(Schema.String),
	start: Schema.NullOr(Schema.String),
	prefix: Schema.NullOr(Schema.String),
	expiresAt: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
})

// ── Route group ──
//
// Org-owned API keys for AI/MCP sessions. Full CRUD open to any member of the
// active org (consumer-responsible — no per-operation human/agent gating);
// `OrgMiddleware` resolves the active member org (and 403s when none is set).
// The key handlers act through Better Auth's owner pool, so the request's
// app_user scope never touches the `apikey` table.
export const ApiKeysGroup = HttpApiGroup.make('apiKeys')
	.add(
		HttpApiEndpoint.post('create', '/api-keys', {
			payload: CreateApiKeyInput,
			success: CreatedApiKeyView,
		}),
	)
	.add(
		HttpApiEndpoint.get('list', '/api-keys', {
			success: Schema.Array(ApiKeyView),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/api-keys/:id', {
			params: { id: Schema.String },
			success: ApiKeyView,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.delete('delete', '/api-keys/:id', {
			params: { id: Schema.String },
			success: Schema.Void,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.middleware(OrgMiddleware)
	.prefix('/v1')
