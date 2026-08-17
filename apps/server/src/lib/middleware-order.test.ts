// Router-wide middleware wraps a request in REVERSE registration order, and
// registration order is layer build order — which `Layer.mergeAll` performs
// concurrently. So the order among them is not something a merge list decides.
//
// It matters because a middleware that answers a caller itself, without passing
// the request on, hides everything registered after it. The MCP sign-in check
// does exactly that for a refused caller, so anything below it never runs for a
// refusal: observability would write no record of the request, and CORS would
// add no headers to the challenge telling a browser client how to authenticate.
//
// These drive a real in-process server through `withGlobalMiddlewareOrder` —
// the same function `main.ts` uses, rather than a copy of it, so re-flattening
// the arrangement there fails here.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, Logger, ManagedRuntime, References } from 'effect'
import {
	HttpMiddleware,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse,
} from 'effect/unstable/http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { applyTestEnv, TEST_ENV } from '../test-env'
import { EnvVars } from './env'
import { withGlobalMiddlewareOrder } from './global-middleware-order'

// Reading the settings only parses them, so no service has to be up for this.
applyTestEnv()
const allowedOrigin = TEST_ENV['ALLOWED_ORIGINS'] as string

const lines: Array<Record<string, unknown>> = []

const CaptureLogs = Logger.layer([
	Logger.make(options => {
		lines.push({
			...options.fiber.getRef(References.CurrentLogAnnotations),
		})
	}),
]).pipe(Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, 'Debug')))

// Stands in for the MCP sign-in check, in the same shape: refuse this route by
// answering the caller directly, and pass anything else on untouched. What it
// authenticates is beside the point — answering without calling onward is what
// hides every middleware registered after it.
const RefusingMiddleware = HttpRouter.middleware(
	HttpMiddleware.make(app =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest
			if (!request.url.startsWith('/refused')) return yield* app
			// Rendering the body is not what is under test, so a failure to render
			// one dies rather than widening the middleware's declared errors.
			return yield* HttpServerResponse.json(
				{ error: 'refused' },
				{ status: 401 },
			).pipe(Effect.orDie)
		}),
	),
	{ global: true },
)

const RoutesLive = HttpRouter.add(
	'GET',
	'/allowed',
	HttpServerResponse.text('ok'),
)

const ServerLive = HttpRouter.serve(
	withGlobalMiddlewareOrder(Layer.mergeAll(RoutesLive, RefusingMiddleware)),
	{ disableListenLog: true, disableLogger: true },
).pipe(
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
	Layer.provide(EnvVars.layer),
	Layer.provideMerge(CaptureLogs),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string

const completions = () =>
	lines.filter(
		line =>
			line['event'] === 'http.request' || line['event'] === 'http.server_error',
	)

describe('a request refused by a middleware that never passes it on', () => {
	beforeAll(async () => {
		const address = await runtime.runPromise(
			Effect.gen(function* () {
				const server = yield* HttpServer.HttpServer
				return server.address
			}),
		)
		if (address._tag !== 'TcpAddress')
			throw new Error('expected a TCP address for the test server')
		baseUrl = `http://127.0.0.1:${address.port}`
	}, 30_000)

	afterAll(() => runtime.dispose())

	beforeEach(() => {
		lines.length = 0
	})

	describe('when the refusal answers before the route is reached', () => {
		it('should leave exactly one record of the request', async () => {
			// GIVEN a request a middleware refuses outright
			const response = await fetch(`${baseUrl}/refused`)

			// WHEN it is answered without ever reaching the route
			expect(response.status).toBe(401)

			// THEN the request still leaves its record, carrying the route and the
			// status — and exactly one, since a middleware registered twice would
			// quietly double every request's logging
			expect(completions()).toHaveLength(1)
			const completion = completions()[0]
			expect(completion?.['http.status']).toBe(401)
			expect(completion?.['http.path_pattern']).toBe('/refused')
			expect(completion?.['request.id']).toEqual(expect.any(String))
		})

		it('should still tell a browser client it may read the answer', async () => {
			// GIVEN the same refusal, asked for by a page on an allowed origin
			const response = await fetch(`${baseUrl}/refused`, {
				headers: { origin: allowedOrigin },
			})

			// THEN the answer carries its cross-origin headers. Refused before CORS
			// could add them, a browser client would be told it was refused and be
			// unable to read why — which is the difference between a client that
			// re-authenticates and one that retries forever
			expect(response.status).toBe(401)
			expect(response.headers.get('access-control-allow-origin')).toBe(
				allowedOrigin,
			)
		})
	})

	describe('when nothing refuses the request', () => {
		it('should reach the route and still record it', async () => {
			// GIVEN a route the refusing middleware passes through
			const response = await fetch(`${baseUrl}/allowed`)

			// THEN the route answers and the request is recorded all the same
			expect(response.status).toBe(200)
			expect(completions()).toHaveLength(1)
			expect(completions()[0]?.['http.status']).toBe(200)
		})
	})
})
