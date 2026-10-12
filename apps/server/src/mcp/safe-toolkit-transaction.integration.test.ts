// Covers the org transaction each MCP tool call runs in over HTTP. A call whose
// statement fails must answer the caller with a tool error, not fail the
// request; and a call that asks the person something and goes on once they
// answer must keep one transaction from start to finish, even though the reply
// to the call starts streaming the moment the question goes out.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { McpSchema, McpServer, Tool, Toolkit } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'
import { SqlClient } from 'effect/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { inMcpOrgScope, McpOrgScope } from './org-scope'
import { MCP_PROTOCOLS } from './protocols'
import { mcpToolkitSafe } from './safe-toolkit'

const BadIdTool = Tool.make('bad_id_thing', { success: Schema.Unknown })
const GoodTool = Tool.make('good_thing', { success: Schema.Unknown })
const AskingTool = Tool.make('asking_thing', {
	success: Schema.Unknown,
	dependencies: [McpSchema.McpServerClient, McpSchema.McpRequestContext],
})
const Tools = Toolkit.make(BadIdTool, GoodTool, AskingTool)

// Which transaction the asking tool's statements ran in, before and after the
// person answered.
const transactions: Array<string> = []

const HandlersLive = Tools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			// A model's guessed id that is not a uuid: Postgres refuses the
			// statement, which aborts the transaction it runs in.
			bad_id_thing: () =>
				sql`SELECT 1 FROM companies WHERE id = ${'not-a-uuid'}`.pipe(
					Effect.orDie,
				),
			good_thing: () =>
				sql`SELECT 1 AS one`.pipe(
					Effect.map(rows => rows[0]),
					Effect.orDie,
				),
			asking_thing: () =>
				Effect.gen(function* () {
					const currentTransaction = sql<{ id: string }>`
						SELECT txid_current()::text AS id
					`.pipe(Effect.map(rows => rows[0]?.id ?? ''))
					transactions.push(yield* currentTransaction)
					const answer = yield* McpServer.elicit({
						message: 'Go ahead?',
						schema: Schema.Struct({ confirm: Schema.Literals(['yes', 'no']) }),
					})
					transactions.push(yield* currentTransaction)
					return answer
				}).pipe(Effect.orDie),
		}
	}),
)

// The way into the org scope that sign-in hands each request in production,
// reduced to the transaction it opens and one setting made inside it, which
// work can read to tell that it ran in the scope.
const SignedIn = HttpRouter.middleware(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return httpEffect =>
			Effect.provideService(httpEffect, McpOrgScope, {
				run: effect =>
					sql
						.withTransaction(
							Effect.andThen(
								sql`SELECT set_config('app.scope_probe', 'in-scope', true)`,
								effect,
							),
						)
						.pipe(Effect.catchTag('SqlError', error => Effect.die(error))),
			})
	}),
	{ global: true },
)

// A resource reading back the setting the scope makes.
const ScopeResource = McpServer.resource({
	uri: 'test://scope',
	name: 'Scope',
	content: inMcpOrgScope(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql<{ probe: string | null }>`
				SELECT current_setting('app.scope_probe', true) AS probe
			`
			return rows[0]?.probe ?? 'outside'
		}).pipe(Effect.orDie),
	),
})

const ServerLive = HttpRouter.serve(
	Layer.mergeAll(
		mcpToolkitSafe(Tools).pipe(Layer.provide(HandlersLive)),
		ScopeResource,
		SignedIn,
	).pipe(
		Layer.provide(
			McpServer.layerHttp({
				name: 'test',
				version: '1.0.0',
				path: '/mcp',
				protocols: MCP_PROTOCOLS,
			}),
		),
	),
	{ disableListenLog: true, disableLogger: true },
).pipe(
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
	Layer.provideMerge(PgLive),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string
let sessionId: string

const post = (body: unknown, sid?: string): Promise<Response> =>
	fetch(`${baseUrl}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(sid ? { 'mcp-session-id': sid } : {}),
		},
		body: JSON.stringify(body),
	})

const callTool = (name: string) =>
	post(
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name, arguments: {} },
		},
		sessionId,
	)

// The reply comes back either as plain JSON or a single SSE frame.
const readReply = async (
	res: Response,
): Promise<{ result?: { isError?: boolean } }> => {
	const text = await res.text()
	const dataLine = text
		.split('\n')
		.filter(line => line.startsWith('data:'))
		.at(-1)
	return JSON.parse(dataLine ? dataLine.replace(/^data:\s*/, '') : text)
}

describe('the org transaction an MCP tool call runs in', () => {
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
		const opening = await post({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: { elicitation: {} },
				clientInfo: { name: 'test', version: '1.0' },
			},
		})
		sessionId = opening.headers.get('mcp-session-id') as string
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when the tool fails on a refused statement', () => {
		it('should answer the caller with a tool error, not a failed request', async () => {
			// GIVEN a tool whose statement Postgres refuses
			// WHEN the client calls it
			const response = await callTool('bad_id_thing')

			// THEN the request itself succeeds and carries the tool's failure,
			// rather than the transaction's commit failing it as a whole
			expect(response.status).toBe(200)
			expect((await readReply(response)).result?.isError).toBe(true)
		})
	})

	describe('when the next call on that connection succeeds', () => {
		it('should be answered normally', async () => {
			// GIVEN a call on this connection that failed on a refused statement
			await callTool('bad_id_thing').then(readReply)

			// WHEN the client calls a tool that works
			const response = await callTool('good_thing')

			// THEN nothing from the earlier failure lingers
			expect(response.status).toBe(200)
			expect((await readReply(response)).result?.isError).toBeFalsy()
		})
	})

	describe('when the tool asks the person something and goes on once they answer', () => {
		it('should keep one transaction from before the question to after the answer', async () => {
			// GIVEN a call to a tool that asks a question mid-call
			const response = await callTool('asking_thing')
			const reader = response.body?.getReader()
			if (reader === undefined) throw new Error('the call had no body')
			const decoder = new TextDecoder()
			let pending = ''
			let answered = false
			let result: { result?: { isError?: boolean } } | undefined

			// WHEN the question arrives on the call's stream and the person answers
			// it in a request of their own
			while (result === undefined) {
				const chunk = await reader.read()
				if (chunk.done) break
				pending += decoder.decode(chunk.value)
				const lines = pending.split('\n')
				pending = lines.pop() ?? ''
				for (const line of lines) {
					if (!line.startsWith('data:')) continue
					const message = JSON.parse(line.slice(5))
					if (message.method === 'elicitation/create' && !answered) {
						answered = true
						await post(
							{
								jsonrpc: '2.0',
								id: message.id,
								result: { action: 'accept', content: { confirm: 'yes' } },
							},
							sessionId,
						).then(reply => reply.text())
					}
					if (message.id === 2) result = message
				}
			}

			// THEN the call completes as an answer, and what it read after the
			// answer ran in the same transaction as what it read before — not on a
			// connection that went back to the pool when the question went out
			expect(answered).toBe(true)
			expect(result?.result?.isError).toBeFalsy()
			expect(transactions).toHaveLength(2)
			expect(transactions[1]).toBe(transactions[0])
		}, 30_000)
	})

	describe('when a resource is read', () => {
		it('should read it inside the org scope', async () => {
			// GIVEN a resource that reads back a setting only the scope makes
			// WHEN the client reads it
			const response = await post(
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'resources/read',
					params: { uri: 'test://scope' },
				},
				sessionId,
			)

			// THEN it saw the scope's setting, so it ran inside the scope rather
			// than as the server's own database role
			const reply = (await readReply(response)) as {
				result?: { contents?: ReadonlyArray<{ text?: string }> }
			}
			expect(reply.result?.contents?.[0]?.text).toBe('in-scope')
		})
	})
})
