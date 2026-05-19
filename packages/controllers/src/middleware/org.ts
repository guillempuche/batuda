import { Schema } from 'effect'
import { HttpApiMiddleware, HttpApiSchema } from 'effect/unstable/httpapi'

import { CurrentOrg } from '@batuda/domain'

import { Forbidden, Unauthorized } from '../errors'

// Re-exported so HTTP routes can grab CurrentOrg from the same module as OrgMiddleware.
export { CurrentOrg }

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
