import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { Forbidden } from '../errors'
import { SessionMiddleware } from '../middleware/session'

// ── Input ──

export const SelectOrgsInput = Schema.Struct({
	clientId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	// The full set of organizations this connection may act in. An empty
	// array unbinds the connection (no membership check); a non-empty array
	// is applied atomically — every org must be a live membership or the
	// whole call rejects and writes nothing.
	organizationIds: Schema.Array(Schema.String),
})

// ── View ──

// One MCP OAuth connection: an OAuth client the caller consented to, with
// the orgs its tokens may act in (empty until chosen). The /mcp Bearer path
// re-checks each against live membership and picks one per request via the
// X-Batuda-Organization-Id hint (single-org users are auto-resolved).
export const McpConnectionView = Schema.Struct({
	clientId: Schema.String,
	name: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	organizationIds: Schema.Array(Schema.String),
	// Host of the client's first redirect URI — provenance shown beside the
	// self-asserted `name` (null if it registered none / they're unparseable).
	redirectHost: Schema.NullOr(Schema.String),
})

// ── Route group ──
//
// Org binding for OAuth MCP connections (ChatGPT, Claude.ai). A connection is a
// `(user, OAuth client)` pair; single-org users are auto-resolved on the /mcp
// path, multi-org users bind each connection to one or more orgs here. The
// /mcp path then picks which org a given request acts in via an
// `X-Batuda-Organization-Id` hint. `SessionMiddleware` only — this is not
// org-scoped (the caller picks among their own memberships); the handler
// validates membership through Better Auth's owner pool.
export const McpOAuthGroup = HttpApiGroup.make('mcpOAuth')
	.add(
		HttpApiEndpoint.post('selectOrgs', '/mcp-oauth/select-orgs', {
			payload: SelectOrgsInput,
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
