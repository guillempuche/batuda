import { Layer } from 'effect'

import { CorsLive } from './cors'
import { ObservabilityLive } from './observability-middleware'

/**
 * Puts the router-wide middleware in the order it has to run in.
 *
 * Router-wide middleware wraps a request in REVERSE registration order, so
 * whichever registers first ends up outermost — and registration order is layer
 * build order, which `Layer.mergeAll` performs concurrently. Listed alongside
 * everything else, these two would land wherever the build happened to put them,
 * and that position could change with nobody editing either of them.
 *
 * Providing them states the order as a dependency the build has to respect:
 * observability is built first and so registers first, then CORS, then whatever
 * the caller passes in.
 *
 * The order matters because a middleware that answers a caller itself, without
 * passing the request on, hides everything registered after it:
 *
 * - **Observability outermost.** The MCP sign-in check refuses a caller
 *   directly, so anything after it never runs for a refusal — and a refused MCP
 *   connection would leave no record of the request at all. That is the case an
 *   MCP client shows as a silent retry loop rather than a visible error, so it
 *   is the one that most needs a record.
 * - **CORS above the sign-in check.** Otherwise a refusal is answered before
 *   CORS can add its headers, and a browser client cannot read the challenge
 *   telling it how to authenticate — nor can a preflight, which carries no
 *   credentials and would be refused rather than answered.
 *
 * This lives apart from `main.ts` so the ordering can be tested: importing
 * `main.ts` starts the server, so a test can only reach the arrangement if the
 * arrangement is somewhere else.
 */
export const withGlobalMiddlewareOrder = <A, E, R>(
	routes: Layer.Layer<A, E, R>,
) => routes.pipe(Layer.provide(CorsLive), Layer.provide(ObservabilityLive))
