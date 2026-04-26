import { Schema, ServiceMap } from 'effect'
import { HttpApiMiddleware, HttpApiSchema } from 'effect/unstable/httpapi'

import { Forbidden, Unauthorized } from '../errors'

/**
 * The active organization for the current request, populated by the
 * `OrgMiddleware`. The implementing Layer lives in `apps/server` because
 * it depends on Better-Auth, Node HTTP, and the Postgres client — this
 * package only declares the Tag so route groups can reference it from
 * their `.middleware(...)` chain without pulling in server-only runtime.
 *
 * Shared across HTTP and MCP code paths: MCP middleware also provides
 * this same tag so service-layer helpers stay context-agnostic.
 */
export class CurrentOrg extends ServiceMap.Service<
	CurrentOrg,
	{
		readonly id: string
		readonly name: string
		readonly slug: string
	}
>()('CurrentOrg') {}

export class OrgMiddleware extends HttpApiMiddleware.Service<
	OrgMiddleware,
	{ provides: CurrentOrg }
>()('OrgMiddleware', {
	// Stack on top of `SessionMiddleware`. Without a session the org can't
	// resolve → Unauthorized is the truthful failure. With a session but no
	// `activeOrganizationId` → Forbidden, because the user is authenticated
	// but hasn't selected an org to act in.
	error: Schema.Union([
		Unauthorized.pipe(HttpApiSchema.status(401)),
		Forbidden.pipe(HttpApiSchema.status(403)),
	]),
}) {}
