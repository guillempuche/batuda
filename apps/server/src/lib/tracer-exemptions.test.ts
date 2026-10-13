// Covers the routes kept out of tracing, served through the same
// `withTracerExemptions` that `main.ts` wraps its app in. A route whose address
// carries a token — a sign-in link, a password reset — would otherwise be
// traced with that token in the recorded URL, and the trace goes to Honeycomb.
// The placement is the part that broke: handed to the app inside
// `HttpRouter.serve`, the exemptions never reached the span the server opens.

import { createServer, request } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { serverSpanRecorder } from './server-span-recorder'
import { withTracerExemptions } from './tracer-exemptions'

// The name of every server span opened. Each case clears it and sends its own
// requests, so what is here belongs to that case alone.
const { names: serverSpans, layer: RecordingTracerLive } = serverSpanRecorder()

const ok = HttpServerResponse.text('ok')
const RoutesLive = Layer.mergeAll(
	HttpRouter.add('GET', '/health', ok),
	HttpRouter.add('GET', '/auth/magic-link/verify', ok),
	HttpRouter.add('GET', '/auth/reset-password/:token', ok),
	HttpRouter.add('GET', '/v1/companies', ok),
)

const ServerLive = withTracerExemptions(
	HttpRouter.serve(RoutesLive, { disableListenLog: true, disableLogger: true }),
).pipe(
	Layer.provide(RecordingTracerLive),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string
let port: number

// Sends the request target exactly as given. `fetch` rewrites a backslash into a
// slash and never sends a full address as the target, so it cannot send either.
const rawGet = (target: string) =>
	new Promise<void>((resolve, reject) => {
		const sent = request(
			{ host: '127.0.0.1', port, path: target },
			response => {
				response.resume()
				response.on('end', resolve)
			},
		)
		sent.on('error', reject)
		sent.end()
	})

describe('the routes kept out of tracing', () => {
	beforeAll(async () => {
		const address = await runtime.runPromise(
			Effect.gen(function* () {
				const server = yield* HttpServer.HttpServer
				return server.address
			}),
		)
		if (address._tag === 'UnixPathAddress')
			throw new Error('expected a TCP address for the test server')
		port = address.port
		baseUrl = `http://127.0.0.1:${port}`
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when a request carries a token in its address', () => {
		it('should open no span for it, so the token is never recorded', async () => {
			serverSpans.length = 0

			// GIVEN a sign-in link and a password reset, each carrying a token
			// WHEN both are served
			await fetch(`${baseUrl}/auth/magic-link/verify?token=secret-1`)
			await fetch(`${baseUrl}/auth/reset-password/secret-2`)

			// THEN neither was traced
			expect(serverSpans).toEqual([])
		})
	})

	describe('when a token route is spelled oddly but still names it', () => {
		it('should open no span for it either', async () => {
			serverSpans.length = 0

			// GIVEN a doubled slash, a percent-encoded letter, capitals, a backslash
			// and a full address — each still naming a route that carries a token
			// WHEN each is served
			await fetch(`${baseUrl}/auth//reset-password/secret-3`)
			await fetch(`${baseUrl}/auth/%72eset-password/secret-4`)
			await fetch(`${baseUrl}/AUTH/MAGIC-LINK/VERIFY?token=secret-5`)
			await rawGet('/auth\\reset-password/secret-6')
			await rawGet(`http://127.0.0.1:${port}/auth/reset-password/secret-7`)

			// THEN none was traced
			expect(serverSpans).toEqual([])
		})
	})

	describe('when the uptime checker polls', () => {
		it('should open no span, with or without a query string', async () => {
			serverSpans.length = 0

			// GIVEN the health check, asked plainly and with a query string
			await fetch(`${baseUrl}/health`)
			await fetch(`${baseUrl}/health?x=1`)

			// THEN neither was traced
			expect(serverSpans).toEqual([])
		})
	})

	describe('when an ordinary request is served', () => {
		it('should still be traced', async () => {
			serverSpans.length = 0

			// GIVEN a request no exemption names
			await fetch(`${baseUrl}/v1/companies`)

			// THEN it was traced as usual — an exemption that swallowed everything
			// would pass the cases above too
			expect(serverSpans).toEqual(['GET'])
		})
	})
})
