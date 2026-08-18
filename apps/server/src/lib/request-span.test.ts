// Covers the arrangement `main.ts` relies on but cannot state in code: it passes
// no middleware to `HttpRouter.serve`, because the platform opens the request
// span on its own. Passing one as well opened a second span for every request —
// a bare twin beside each real one, doubling every count read from the traces.
//
// Both directions matter here. Passing a tracer again makes the count 2, and a
// platform release that stops opening the span makes it 0 — which would end
// tracing silently, with nothing failing anywhere else.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Tracer } from 'effect'
import {
	HttpRouter,
	HttpServer,
	HttpServerResponse,
} from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Names of the spans opened for an incoming request, in the order they opened.
// A module-level array because the tracer is built once, with the server.
const serverSpans: Array<string> = []

const countingTracer = (inner: Tracer.Tracer): Tracer.Tracer => ({
	...inner,
	span(options) {
		if (options.kind === 'server') serverSpans.push(options.name)
		return inner.span(options)
	},
})

const CountingTracerLive = Layer.effect(Tracer.Tracer)(
	Effect.map(Effect.service(Tracer.Tracer), countingTracer),
)

const RoutesLive = Layer.mergeAll(
	HttpRouter.add('GET', '/ok', HttpServerResponse.text('ok')),
	// Dies rather than fails, which is the harder case: the defect reaches the
	// platform after the response has gone out.
	HttpRouter.add('GET', '/boom', Effect.die(new Error('boom'))),
)

// The live arrangement: no `middleware` option, so the platform's own span is
// the only one.
const ServerLive = HttpRouter.serve(RoutesLive, {
	disableListenLog: true,
	disableLogger: true,
}).pipe(
	Layer.provide(CountingTracerLive),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string

describe('the span a request leaves behind', () => {
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

	describe('when a request is served', () => {
		it('should open exactly one span for it', async () => {
			// GIVEN a server arranged the way main.ts arranges it
			serverSpans.length = 0

			// WHEN one request is served
			const response = await fetch(`${baseUrl}/ok`)

			// THEN one span was opened, not two
			expect(response.status).toBe(200)
			expect(serverSpans).toEqual(['http.server GET'])
		})
	})

	describe('when the route dies', () => {
		it('should answer 500, leave one span, and keep serving', async () => {
			// GIVEN a route that dies mid-request
			serverSpans.length = 0

			// WHEN it is called
			const response = await fetch(`${baseUrl}/boom`)

			// THEN the caller is answered and the request left one span
			expect(response.status).toBe(500)
			expect(serverSpans).toEqual(['http.server GET'])

			// AND the server is still there for the next caller — nothing about the
			// defect reached the scope holding the server
			serverSpans.length = 0
			const next = await fetch(`${baseUrl}/ok`)
			expect(next.status).toBe(200)
			expect(serverSpans).toEqual(['http.server GET'])
		})
	})
})
