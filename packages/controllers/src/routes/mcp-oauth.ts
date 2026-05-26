import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Forbidden } from '../errors'
import { SessionMiddleware } from '../middleware/session'

// ── Input ──

export const SelectOrgInput = Schema.Struct({
	clientId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	organizationId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
})

// ── View ──

// One MCP OAuth connection: an OAuth client the caller consented to, with the
// org its tokens currently act in (`null` until a multi-org user picks one).
export const McpConnectionView = Schema.Struct({
	clientId: Schema.String,
	name: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	organizationId: Schema.NullOr(Schema.String),
})

// ── Route group ──
//
// Org binding for OAuth MCP connections (ChatGPT, Claude.ai). A connection is a
// `(user, OAuth client)` pair; single-org users are auto-resolved on the /mcp
// path, multi-org users bind each connection to an org here. `SessionMiddleware`
// only — this is not org-scoped (the caller picks among their own memberships);
// the handler validates membership through Better Auth's owner pool.
export const McpOAuthGroup = HttpApiGroup.make('mcpOAuth')
	.add(
		HttpApiEndpoint.post('selectOrg', '/mcp-oauth/select-org', {
			payload: SelectOrgInput,
			success: Schema.Void,
			error: Forbidden.pipe(HttpApiSchema.status(403)),
		}),
	)
	.add(
		HttpApiEndpoint.get('listConnections', '/mcp-oauth/connections', {
			success: Schema.Array(McpConnectionView),
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
