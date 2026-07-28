import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { BadRequest, Forbidden, NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// ── Input ──

export const SelectOrgsInput = Schema.Struct({
	clientId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	// The organizations this connection may act in, applied atomically —
	// every org must be a live membership or the whole call rejects and
	// writes nothing. Must not be empty: removing access goes through
	// `revokeConnection`, which records the removal rather than erasing the
	// choice.
	organizationIds: Schema.Array(Schema.String),
})

// Cut a connection off from the acting organization. `userId` names whose
// connection to revoke — omitted, it is the caller's own; supplied, only an
// owner or admin of the org may do it.
export const RevokeConnectionInput = Schema.Struct({
	clientId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	userId: Schema.optional(Schema.String),
})

// ── View ──

// An organization this connection has been cut off from. `blockedBySelf`
// tells apart a removal the person made on their own connection, which they
// can undo by choosing that organization again, from one an owner made for
// the whole organization, which they cannot.
export const McpConnectionBlock = Schema.Struct({
	organizationId: Schema.String,
	blockedBySelf: Schema.Boolean,
})

// One MCP OAuth connection: an OAuth client the caller consented to, with
// the orgs its tokens may act in (empty until chosen). The /mcp Bearer path
// re-checks each against live membership; a single organization resolves on
// its own, and a request has to name which one when there are several.
export const McpConnectionView = Schema.Struct({
	clientId: Schema.String,
	name: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	// What the connection can reach right now: chosen, minus anything blocked.
	organizationIds: Schema.Array(Schema.String),
	// Everything chosen, blocked organizations included. Empty means nobody has
	// chosen yet, which — with nothing blocked — reaches every organization the
	// person belongs to. Kept apart from `organizationIds` so a connection
	// blocked down to nothing is not read as one nobody has chosen for.
	chosenOrganizationIds: Schema.Array(Schema.String),
	blocks: Schema.Array(McpConnectionBlock),
	// Host of the client's first redirect URI — provenance shown beside the
	// self-asserted `name` (null if it registered none / they're unparseable).
	redirectHost: Schema.NullOr(Schema.String),
})

// One connection as an owner or admin sees it: whose it is, what tool last
// used it, and when. The tool name is self-reported by that tool, so it tells
// connections apart rather than proving anything about the caller.
export const OrgMcpConnectionView = Schema.Struct({
	clientId: Schema.String,
	userId: Schema.String,
	memberName: Schema.NullOr(Schema.String),
	memberEmail: Schema.String,
	name: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	redirectHost: Schema.NullOr(Schema.String),
	client: Schema.NullOr(
		Schema.Struct({
			name: Schema.NullOr(Schema.String),
			version: Schema.NullOr(Schema.String),
		}),
	),
	lastUsedAt: Schema.NullOr(Schema.String),
	// Set when this organization has cut the connection off, null when it has
	// not.
	block: Schema.NullOr(
		Schema.Struct({
			byUserId: Schema.String,
			byName: Schema.NullOr(Schema.String),
			at: Schema.String,
			// Whether the member has still chosen this organization for the
			// assistant. Lifting a removal only hands access back when they have.
			boundHere: Schema.Boolean,
		}),
	),
})

// Let a connection work in the acting organization again. `userId` names whose
// connection, and is never optional: the removal being lifted was usually aimed
// at someone other than the owner or admin asking.
export const RestoreConnectionInput = Schema.Struct({
	clientId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
	userId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
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
			error: [
				Forbidden.pipe(HttpApiSchema.status(403)),
				BadRequest.pipe(HttpApiSchema.status(400)),
			],
		}),
	)
	.add(
		HttpApiEndpoint.get('listConnections', '/mcp-oauth/connections', {
			success: Schema.Array(McpConnectionView),
		}),
	)
	.add(
		// Org-scoped, unlike its siblings: cutting a connection off is always
		// about one organization, and the write needs `app.current_org_id` set
		// for the revocation table's WITH CHECK to hold. OrgMiddleware is
		// attached to this endpoint alone — at group level it would 403 the
		// members who come here to pick an org in the first place.
		HttpApiEndpoint.post('revokeConnection', '/mcp-oauth/revoke', {
			payload: RevokeConnectionInput,
			success: Schema.Void,
			error: [
				Forbidden.pipe(HttpApiSchema.status(403)),
				NotFound.pipe(HttpApiSchema.status(404)),
			],
		}).middleware(OrgMiddleware),
	)
	.add(
		// The way back from a removal an owner made. Org-scoped like revoke: it
		// only ever clears what was recorded against the organization the
		// request is already acting in.
		HttpApiEndpoint.post('restoreConnection', '/mcp-oauth/restore', {
			payload: RestoreConnectionInput,
			success: Schema.Void,
			error: [
				Forbidden.pipe(HttpApiSchema.status(403)),
				NotFound.pipe(HttpApiSchema.status(404)),
			],
		}).middleware(OrgMiddleware),
	)
	.add(
		// Org-scoped for the same reason as revoke: it answers what can reach
		// THIS organization, and which organization that is comes from the
		// session, never from anything the caller passes in.
		HttpApiEndpoint.get('listOrgConnections', '/mcp-oauth/org-connections', {
			success: Schema.Array(OrgMcpConnectionView),
			error: Forbidden.pipe(HttpApiSchema.status(403)),
		}).middleware(OrgMiddleware),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')
