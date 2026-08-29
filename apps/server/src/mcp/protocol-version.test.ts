// Covers a client opening an MCP connection with a protocol revision newer than
// the library knows, which the route would otherwise refuse with an empty 400 it
// cannot recover from.
//
// These drive a real in-process MCP server through a middleware shaped like the
// live one — open the record, normalise the request, name the call, read its
// body, hand the same one onward — because the worst failure here is invisible to
// the header logic alone: a request remembers the body it read and a copy does
// not, so handing the route the other one leaves it waiting on a drained stream,
// with no error, no timeout, and no response ever. Only the round trip catches
// that.
//
// The refusal a settled connection still gets is covered here too: it is the
// library's own answer, so only a real server produces it, and what a client and
// a reader can learn from it is the whole point of the cases below.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import {
	Effect,
	Layer,
	Logger,
	ManagedRuntime,
	References,
	Schema,
} from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpRouter, HttpServer, HttpServerRequest } from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withRequestRecord } from '../lib/observability-middleware'
import {
	explainRefusedVersion,
	recordCall,
	withNegotiableProtocolVersion,
} from './http'

// Every line the server wrote, read the way the built-in formatters read them:
// annotations live on the fiber, not on the log options.
const lines: Array<{
	readonly level: string
	readonly annotations: Record<string, unknown>
}> = []

const CaptureLogsLive = Layer.provideMerge(
	Layer.succeed(References.MinimumLogLevel, 'Debug'),
)(
	Logger.layer([
		Logger.make(options => {
			lines.push({
				level: String(options.logLevel),
				annotations: {
					...options.fiber.getRef(References.CurrentLogAnnotations),
				},
			})
		}),
	]),
)

const lineFor = (event: string) =>
	lines.find(line => line.annotations['event'] === event)

// What a client should be able to read off a refusal.
const JsonRpcError = Schema.Struct({
	jsonrpc: Schema.String,
	error: Schema.Struct({ code: Schema.Number, message: Schema.String }),
})

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
			// The request record is opened outermost in the live server, which is
			// what lets the steps below write facts onto the request's own line.
			withRequestRecord(
				Effect.gen(function* () {
					const incoming = yield* HttpServerRequest.HttpServerRequest
					if (!incoming.url.startsWith('/mcp')) return yield* httpEffect
					const req = yield* withNegotiableProtocolVersion(incoming)
					yield* recordCall(incoming)
					// The live middleware reads the body here, to record which client
					// called; doing the same is the point of this harness.
					yield* req.json.pipe(Effect.orElseSucceed(() => null))
					return yield* explainRefusedVersion(httpEffect, req).pipe(
						Effect.provideService(HttpServerRequest.HttpServerRequest, req),
					)
				}),
			)
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
	disableLogger: true,
}).pipe(
	Layer.provide(CaptureLogsLive),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

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
		it('should refuse it with something the client can read', async () => {
			// GIVEN a connection that already settled a revision
			const opening = await initialize()
			const sessionId = opening.headers.get('mcp-session-id') as string
			lines.length = 0

			// WHEN a later request names one the library does not know
			const response = await post(
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'ping', arguments: {} },
				},
				{
					'mcp-session-id': sessionId,
					'mcp-protocol-version': '2026-07-28',
					'mcp-method': 'server/discover',
				},
			)

			// THEN the refusal stands — the client was told which revision this is,
			// so naming another one is its own mistake to fix
			expect(response.status).toBe(400)

			// AND it carries a JSON-RPC error naming the revision, rather than the
			// empty body a client can do nothing with. Decoding is half the
			// assertion: a body of another shape fails here.
			const body = Schema.decodeUnknownSync(JsonRpcError)(await response.json())
			expect(body.error.code).toBe(-32000)
			expect(body.error.message).toContain('2026-07-28')
		})

		it('should leave an ordinary line when only a probe was refused', async () => {
			// GIVEN a client probing for a newer era on a settled connection, which
			//       is how a client finds out which revisions a server speaks
			const opening = await initialize()
			const sessionId = opening.headers.get('mcp-session-id') as string
			lines.length = 0
			await post(
				{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} },
				{
					'mcp-session-id': sessionId,
					'mcp-protocol-version': '2026-07-28',
					'mcp-method': 'server/discover',
				},
			)

			// THEN the refusal reads as routine: a probe being told "no" is the answer
			// it went looking for, and warning about it would bury the refusals that
			// do mean something
			const refusal = lineFor('mcp.protocol_version.refused')
			expect(refusal?.level).toBe('Info')
			expect(refusal?.annotations['mcp.protocol_version.named']).toBe(
				'2026-07-28',
			)

			// AND the request's own line says which call it was, so the 400 explains
			// itself without hunting for the line beside it
			const request = lineFor('http.request')
			expect(request?.annotations['mcp.method']).toBe('server/discover')
			expect(request?.annotations['mcp.protocol_version.named']).toBe(
				'2026-07-28',
			)
			expect(request?.annotations['http.status']).toBe(400)
		})

		it('should warn when the refused call was real work', async () => {
			// GIVEN a client naming an unknown revision on a call meant to do
			//       something, rather than on a probe
			const opening = await initialize()
			const sessionId = opening.headers.get('mcp-session-id') as string
			lines.length = 0
			await post(
				{
					jsonrpc: '2.0',
					id: 6,
					method: 'tools/call',
					params: { name: 'ping', arguments: {} },
				},
				{
					'mcp-session-id': sessionId,
					'mcp-protocol-version': '2026-07-28',
					'mcp-method': 'tools/call',
				},
			)

			// THEN it is worth a warning — the client asked for work and did not get
			// it, which is a client to fix rather than one looking around
			expect(lineFor('mcp.protocol_version.refused')?.level).toBe('Warn')
		})

		it('should warn when the client names no call at all', async () => {
			// GIVEN a client that sends no method header, as one that does not
			//       implement the newer routing headers will not
			const opening = await initialize()
			const sessionId = opening.headers.get('mcp-session-id') as string
			lines.length = 0
			await post(
				{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} },
				{
					'mcp-session-id': sessionId,
					'mcp-protocol-version': '2026-07-28',
				},
			)

			// THEN the louder level stands: nothing here says this was a probe, and
			// guessing that it was would silence the case worth hearing about
			expect(lineFor('mcp.protocol_version.refused')?.level).toBe('Warn')
		})
	})

	describe('when a client asks what this server speaks, with no session yet', () => {
		it('should refuse it plainly rather than hand back a crash as a success', async () => {
			// GIVEN an assistant asking which revisions this server speaks before any
			//       connection exists, which is how one looks for a newer era
			lines.length = 0
			const response = await post(
				{ jsonrpc: '2.0', id: 8, method: 'server/discover', params: {} },
				{
					'mcp-protocol-version': '2026-07-28',
					'mcp-method': 'server/discover',
				},
			)

			// THEN it is turned down the same way an established connection is turned
			// down, instead of being let through to a layer with no handler for it
			expect(response.status).toBe(400)
			const body = Schema.decodeUnknownSync(JsonRpcError)(await response.json())
			expect(body.error.code).toBe(-32000)
			expect(body.error.message).toContain('2026-07-28')
		})

		it("should keep the runtime's own failure shape away from the client", async () => {
			// GIVEN the same question asked the same way
			const response = await post(
				{ jsonrpc: '2.0', id: 9, method: 'server/discover', params: {} },
				{
					'mcp-protocol-version': '2026-07-28',
					'mcp-method': 'server/discover',
				},
			)

			// THEN nothing describing how this server fails internally reaches the
			// caller — it used to receive the crash itself, wrapped in a success
			const text = await response.text()
			expect(text).not.toContain('Unknown request tag')
			expect(text).not.toContain('Die')
		})

		it('should still let an opening handshake settle a revision', async () => {
			// GIVEN the negotiation this exclusion sits beside: an opening call naming
			//       a revision the library does not know, sent as an assistant sends it
			const response = await initialize({
				'mcp-protocol-version': '2026-07-28',
				'mcp-method': 'initialize',
			})

			// THEN it is still served — that call names its revision in the body too,
			// so it can settle one with the header gone
			expect(response.status).toBe(200)
			expect(response.headers.get('mcp-session-id')).toBeTruthy()
		})
	})

	describe('when the body is broken rather than the revision', () => {
		it('should not blame the revision for it', async () => {
			// GIVEN a settled connection naming a revision this server DOES know
			const opening = await initialize()
			const sessionId = opening.headers.get('mcp-session-id') as string
			lines.length = 0

			// WHEN the body it sends is not valid JSON
			const response = await fetch(`${baseUrl}/mcp`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-session-id': sessionId,
					'mcp-protocol-version': '2025-06-18',
				},
				body: '{"jsonrpc":"2.0","id":5,"method":',
			})

			// THEN nothing claims the revision was the problem — a bad body and a
			// refused revision both end in 400, and telling a client to re-open its
			// connection would send it chasing the wrong thing
			expect(await response.text()).not.toContain('Unsupported MCP protocol')
			expect(lineFor('mcp.protocol_version.refused')).toBeUndefined()
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
