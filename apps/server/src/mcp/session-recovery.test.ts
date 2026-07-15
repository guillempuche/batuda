// Pins the recovery that unblocks every MCP client after a server redeploy: a
// fresh process has an empty in-memory session table, so a client keeps sending
// a session id it never minted. McpServer answers that unknown `Mcp-Session-Id`
// with a 404, and a compliant client drops the session and re-`initialize`s.
//
// Drives a real McpServer over an in-process HTTP server so a future effect
// release that changes the unknown-session reply fails here, not in prod.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('the /mcp route recovering an unknown session end to end', () => {
	const Ping = Tool.make('ping', { success: Schema.String })
	const PingTools = Toolkit.make(Ping)
	const PingHandlersLive = PingTools.toLayer(
		Effect.succeed({ ping: () => Effect.succeed('pong') }),
	)

	const McpHttpLive = McpServer.toolkit(PingTools).pipe(
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
