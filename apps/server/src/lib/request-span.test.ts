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
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { serverSpanRecorder } from './server-span-recorder'

// Names of the spans opened for an incoming request, in the order they opened.
const { names: serverSpans, layer: CountingTracerLive } = serverSpanRecorder()

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
		if (address._tag === 'UnixPathAddress')
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
			expect(serverSpans).toEqual(['GET'])
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
			expect(serverSpans).toEqual(['GET'])

			// AND the server is still there for the next caller — nothing about the
			// defect reached the scope holding the server
			serverSpans.length = 0
			const next = await fetch(`${baseUrl}/ok`)
			expect(next.status).toBe(200)
			expect(serverSpans).toEqual(['GET'])
		})
	})
})
