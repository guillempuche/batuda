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
 * - **Observability outermost.** CORS answers a browser's preflight itself, so
 *   with observability below it a preflight would leave no record at all.
 * - **CORS above whatever the caller passes in.** A router-wide middleware that
 *   refuses a caller would otherwise answer before CORS could add its headers,
 *   and a browser client could not read why it was refused.
 *
 * The MCP sign-in check is not among them: it wraps only the MCP routes, so it
 * runs inside all of these whatever order they register in.
 *
 * This lives apart from `main.ts` so the ordering can be tested: importing
 * `main.ts` starts the server, so a test can only reach the arrangement if the
 * arrangement is somewhere else.
 */
export const withGlobalMiddlewareOrder = <A, E, R>(
	routes: Layer.Layer<A, E, R>,
) => routes.pipe(Layer.provide(CorsLive), Layer.provide(ObservabilityLive))
