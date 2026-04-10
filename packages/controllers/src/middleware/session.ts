import { ServiceMap } from 'effect'
import { HttpApiMiddleware, HttpApiSchema } from 'effect/unstable/httpapi'

import { Unauthorized } from '../errors'

/**
 * Session context provided by the `SessionMiddleware` to every protected
 * handler. The implementing Layer lives in `apps/server` because it
 * depends on Better-Auth and Node HTTP — this package only declares the
 * Tag so route groups can reference it in their `.middleware(...)` call
 * without pulling in the server-only runtime.
 */
export class SessionContext extends ServiceMap.Service<
	SessionContext,
	{
		readonly userId: string
		readonly email: string
		readonly name: string | undefined
		readonly isAgent: boolean
	}
>()('SessionContext') {}

export class SessionMiddleware extends HttpApiMiddleware.Service<
	SessionMiddleware,
	{ provides: SessionContext }
>()('SessionMiddleware', {
	error: Unauthorized.pipe(HttpApiSchema.status(401)),
}) {}
