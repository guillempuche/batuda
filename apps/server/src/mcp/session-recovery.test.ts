// Pins the recovery that unblocks every MCP client after a server redeploy:
// McpServer answers a tools/call whose session id it no longer knows with a
// normal HTTP 200 whose body hides the failure, so recoverUnknownSession swaps
// that for the MCP spec's 404 (and leaves every other reply alone).
//
// Two levels of cover: the unit block feeds recoverUnknownSession hand-built
// replies to exercise every branch; the round-trip block drives a real
// McpServer over an in-process HTTP server so a future effect release that
// changes the unknown-session reply's shape or message fails here, not in prod.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import {
	HttpRouter,
	HttpServer,
	HttpServerResponse,
} from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { recoverUnknownSession } from './http'

// The reply effect's McpServer sends when it does not recognise the request's
// Mcp-Session-Id: an HTTP 200 with the failure folded into the JSON-RPC error
// cause as a `Die`. The nested `message` string is McpServer's own; the matcher
// keys off the structured `data` array, so this is shaped exactly as observed.
const UNKNOWN_SESSION_REPLY = JSON.stringify({
	jsonrpc: '2.0',
	id: 3,
	error: {
		_tag: 'Cause',
		code: 0,
		message:
			'[{"_tag":"Die","defect":{"message":"Mcp-Session-Id does not exist","name":"Error"}}]',
		data: [
			{
				_tag: 'Die',
				defect: { message: 'Mcp-Session-Id does not exist', name: 'Error' },
			},
		],
	},
})

// Build the same kind of collected-text reply the JSON-RPC transport emits, so
// recovery sees a byte-array body just as it does in production.
const jsonReply = (body: string) =>
	HttpServerResponse.text(body, { contentType: 'application/json' })

const bodyText = (response: HttpServerResponse.HttpServerResponse) =>
	response.body._tag === 'Uint8Array'
		? new TextDecoder().decode(response.body.body)
		: undefined

const run = (response: HttpServerResponse.HttpServerResponse) =>
	Effect.runPromise(recoverUnknownSession(response))

describe('recoverUnknownSession', () => {
	describe('when McpServer buries an unknown-session failure in a 200 reply', () => {
		it('should answer 404 with a JSON-RPC error so the client re-initializes', async () => {
			// GIVEN McpServer's unknown-session reply (HTTP 200, failure in the body)
			const response = jsonReply(UNKNOWN_SESSION_REPLY)

			// WHEN recovery inspects it
			const recovered = await run(response)

			// THEN it becomes a 404 carrying the reinitialize hint, not a 200 or 5xx
			expect(recovered.status).toBe(404)
			const body = JSON.parse(bodyText(recovered) ?? '{}') as {
				error?: { code?: number; message?: string }
			}
			expect(body.error?.code).toBe(-32001)
			expect(body.error?.message).toBe('MCP session expired; reinitialize')
		})

		it('should also answer 404 when the failure arrives inside a batched array', async () => {
			// GIVEN the same failure wrapped in a JSON-RPC batch (array of replies)
			const response = jsonReply(`[${UNKNOWN_SESSION_REPLY}]`)

			// WHEN recovery inspects it
			const recovered = await run(response)

			// THEN the batch is still recognised and rewritten to 404
			expect(recovered.status).toBe(404)
		})
	})

	describe('when the reply is anything else', () => {
		it('should pass a healthy tool reply straight through', async () => {
			// GIVEN a normal tools/call reply (HTTP 200 with a real result)
			const response = jsonReply(
				JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					result: {
						content: [{ type: 'text', text: '"pong"' }],
						isError: false,
					},
				}),
			)

			// WHEN recovery inspects it
			const recovered = await run(response)

			// THEN the original reply is returned untouched (same object, still 200)
			expect(recovered).toBe(response)
			expect(recovered.status).toBe(200)
		})

		it('should not rewrite a tool result that merely echoes the failure phrase', async () => {
			// GIVEN a successful reply whose text happens to contain the phrase, but
			// as tool content under `result` — not in McpServer's error cause
			const response = jsonReply(
				JSON.stringify({
					jsonrpc: '2.0',
					id: 5,
					result: {
						content: [
							{ type: 'text', text: 'log line: Mcp-Session-Id does not exist' },
						],
						isError: false,
					},
				}),
			)

			// WHEN recovery inspects it
			const recovered = await run(response)

			// THEN the cheap phrase gate opens but the structural check rejects it, so
			// the real result is preserved (no false 404)
			expect(recovered).toBe(response)
		})

		it('should pass through a body that carries the phrase but is not valid JSON', async () => {
			// GIVEN a non-JSON body that still contains the phrase (defensive: the
			// transport always sends JSON, but a parse failure must never 404)
			const response = jsonReply('plain text: Mcp-Session-Id does not exist')

			// WHEN recovery inspects it
			const recovered = await run(response)

			// THEN it is left untouched
			expect(recovered).toBe(response)
		})

		it('should pass through a reply whose body is not a readable byte array', async () => {
			// GIVEN a response with no materialised body for recovery to inspect
			const response = HttpServerResponse.empty({ status: 200 })

			// WHEN recovery inspects it
			const recovered = await run(response)

			// THEN it is returned untouched
			expect(recovered).toBe(response)
		})
	})
})

// Drives a real McpServer wrapped with recoverUnknownSession over a loopback
// HTTP server, mirroring how the /mcp route wires the recovery. This is the
// guard against the exact production bug: a session id from before a redeploy is
// unknown to the fresh process.
describe('the /mcp route recovering an unknown session end to end', () => {
	const Ping = Tool.make('ping', { success: Schema.String })
	const PingTools = Toolkit.make(Ping)
	const PingHandlersLive = PingTools.toLayer(
		Effect.succeed({ ping: () => Effect.succeed('pong') }),
	)

	// Same shape as the /mcp wiring: recoverUnknownSession runs on the McpServer
	// handler's reply. httpEffect is left un-annotated so its branded middleware
	// error type is inferred, exactly as the real /mcp middleware does.
	const RecoveryMiddleware = HttpRouter.middleware(
		Effect.gen(function* () {
			return httpEffect =>
				httpEffect.pipe(Effect.flatMap(recoverUnknownSession))
		}),
		{ global: true },
	)

	const McpHttpLive = Layer.mergeAll(
		McpServer.toolkit(PingTools),
		RecoveryMiddleware,
	).pipe(
		Layer.provide(PingHandlersLive),
		Layer.provide(
			McpServer.layerHttp({ name: 'test', version: '1.0.0', path: '/mcp' }),
		),
	)

	const ServerLive = HttpRouter.serve(McpHttpLive, {
		disableListenLog: true,
	}).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))

	const runtime = ManagedRuntime.make(ServerLive)
	let baseUrl: string

	const post = (body: unknown, sessionId?: string) =>
		fetch(`${baseUrl}/mcp`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				...(sessionId ? { 'mcp-session-id': sessionId } : {}),
			},
			body: JSON.stringify(body),
		})

	const initialize = () =>
		post({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'test', version: '1.0' },
			},
		})

	const callPing = (sessionId: string) =>
		post(
			{
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'ping', arguments: {} },
			},
			sessionId,
		)

	beforeAll(async () => {
		// Building the server layer binds the loopback port; read it back for the
		// request URLs.
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

	describe('when the session id is one the process minted', () => {
		it('should serve a tool call after initialize', async () => {
			// GIVEN a fresh initialize handshake
			const initRes = await initialize()
			const sessionId = initRes.headers.get('mcp-session-id')

			// THEN the server issues a session id
			expect(initRes.status).toBe(200)
			expect(sessionId).toBeTruthy()

			// WHEN a tool is called with that live session
			const okRes = await callPing(sessionId as string)

			// THEN it succeeds
			expect(okRes.status).toBe(200)
		})
	})

	describe('when the session id predates the last redeploy', () => {
		it('should answer 404 so the client re-initializes', async () => {
			// GIVEN a session id the process never minted (as every id becomes after
			// a redeploy replaces the process)
			const staleSessionId = '00000000-0000-0000-0000-000000000000'

			// WHEN a tool is called with it
			const res = await callPing(staleSessionId)

			// THEN the client is told to re-initialize (404), not handed a
			// hidden-failure 200 or a 5xx
			expect(res.status).toBe(404)
			const body = (await res.json()) as { error?: { code?: number } }
			expect(body.error?.code).toBe(-32001)
		})

		it('should recover once the client initializes again', async () => {
			// GIVEN a client that re-initializes (what a compliant client does on 404)
			const initRes = await initialize()
			const sessionId = initRes.headers.get('mcp-session-id')
			expect(initRes.status).toBe(200)

			// WHEN it retries the tool call with the fresh session
			const okRes = await callPing(sessionId as string)

			// THEN it is back to working
			expect(okRes.status).toBe(200)
		})
	})
})
