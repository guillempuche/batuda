// Covers a client opening an MCP connection with a protocol revision newer than
// the library knows, which the route would otherwise refuse with an empty 400 it
// cannot recover from.
//
// These drive a real in-process MCP server through a middleware shaped like the
// live one — normalise the request, read its body, hand the same one onward —
// because the worst failure here is invisible to the header logic alone: a
// request remembers the body it read and a copy does not, so handing the route
// the other one leaves it waiting on a drained stream, with no error, no
// timeout, and no response ever. Only the round trip catches that.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withNegotiableProtocolVersion } from './http'

const Ping = Tool.make('ping', { success: Schema.String })
const PingTools = Toolkit.make(Ping)
const PingHandlersLive = PingTools.toLayer(
	Effect.succeed({ ping: () => Effect.succeed('pong') }),
)

// The live middleware's order, with the auth and database work left out: it is
// the sequence that matters, not what it authenticates.
const NegotiationMiddleware = HttpRouter.middleware(
	Effect.gen(function* () {
		return httpEffect =>
			Effect.gen(function* () {
				const incoming = yield* HttpServerRequest.HttpServerRequest
				if (!incoming.url.startsWith('/mcp')) return yield* httpEffect
				const req = yield* withNegotiableProtocolVersion(incoming)
				// The live middleware reads the body here, to record which client
				// called; doing the same is the point of this harness.
				yield* req.json.pipe(Effect.orElseSucceed(() => null))
				return yield* httpEffect.pipe(
					Effect.provideService(HttpServerRequest.HttpServerRequest, req),
				)
			})
	}),
	{ global: true },
)

const McpHttpLive = Layer.mergeAll(
	McpServer.toolkit(PingTools).pipe(Layer.provide(PingHandlersLive)),
	NegotiationMiddleware,
).pipe(
	Layer.provide(
		McpServer.layerHttp({ name: 'test', version: '1.0.0', path: '/mcp' }),
	),
)

const ServerLive = HttpRouter.serve(McpHttpLive, {
	disableListenLog: true,
}).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string

const post = (
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> =>
	fetch(`${baseUrl}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(body),
	})

const initialize = (headers: Record<string, string> = {}) =>
	post(
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'test', version: '1.0' },
			},
		},
		headers,
	)

describe('the /mcp route meeting a protocol revision it does not know', () => {
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

	describe('when a client opens with a revision newer than the library knows', () => {
		it('should let the exchange settle a revision instead of refusing it', async () => {
			// GIVEN a client naming a revision the specification has published but
			//       the library has not caught up to
			const response = await initialize({
				'mcp-protocol-version': '2026-07-28',
			})

			// THEN it is served rather than refused, and told which revision it got
			expect(response.status).toBe(200)
			expect(response.headers.get('mcp-session-id')).toBeTruthy()
		})
	})

	describe('when a call follows on that same connection', () => {
		it('should answer, rather than wait forever on a body already read', async () => {
			// GIVEN a settled connection whose opening request had its body read
			//       by the middleware before the route saw it
			const opening = await initialize({
				'mcp-protocol-version': '2026-07-28',
			})
			const sessionId = opening.headers.get('mcp-session-id') as string

			// WHEN the client calls a tool
			const response = await post(
				{
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'ping', arguments: {} },
				},
				{ 'mcp-session-id': sessionId },
			)

			// THEN a reply arrives at all — handing the route a different request
			// than the body was read from would hang here with no error
			expect(response.status).toBe(200)
			expect(await response.text()).toContain('pong')
		}, 10_000)
	})

	describe('when a client names a bad revision after one was agreed', () => {
		it('should still refuse it, since it was told what to send', async () => {
			// GIVEN a connection that already settled a revision
			const opening = await initialize()
			const sessionId = opening.headers.get('mcp-session-id') as string

			// WHEN a later request names one the library does not know
			const response = await post(
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'ping', arguments: {} },
				},
				{ 'mcp-session-id': sessionId, 'mcp-protocol-version': '2026-07-28' },
			)

			// THEN the refusal stands — the client was told which revision this is,
			// so naming another one is its own mistake to fix
			expect(response.status).toBe(400)
		})
	})

	describe('when a client names nothing at all', () => {
		it('should be served unchanged', async () => {
			// GIVEN a client that omits the header, as one does before agreeing a
			//       revision
			// THEN nothing about the request is touched
			const response = await initialize()
			expect(response.status).toBe(200)
		})
	})
})
