// Covers what mcpToolkitSafe corrects on top of the library, at two levels: the
// unit blocks feed the shaping helpers the shapes handlers actually produce; the
// round-trip block drives tools registered with mcpToolkitSafe over a real
// in-process MCP HTTP server and asserts what the client receives, so a future
// effect release that changes the bridge's result/error rendering fails here
// rather than in prod.
//
// The error half turns on one distinction: a failure whose wording was written
// for the caller reaches them, and everything else does not, because an internal
// fault's text carries database phrasing and table names. A failure the caller
// cannot see must still reach the server log, or nobody can answer "why did that
// tool fail" — asserted here too, since the ordering that guarantees it is easy
// to lose.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, Logger, ManagedRuntime, Schema } from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	clientFacingMessage,
	mcpToolkitSafe,
	toStructuredContent,
} from './safe-toolkit'
import { ToolMessage } from './tool-message'

describe('toStructuredContent', () => {
	describe('when the handler returns a plain object', () => {
		it('should pass the record through unchanged', () => {
			// GIVEN a record result (the already-valid shape)
			const value = { id: 1, name: 'Ada' }
			// WHEN normalizing it for structured output
			// THEN it is returned as-is
			expect(toStructuredContent(value)).toBe(value)
		})
	})

	describe('when the handler returns a bare array', () => {
		it('should wrap it in an items record so it stays valid structured output', () => {
			// GIVEN a list result — a bare array is not valid MCP structured output
			// WHEN normalizing it
			const result = toStructuredContent([1, 2, 3])
			// THEN it becomes an object under `items`, preserving the rows
			expect(result).toEqual({ items: [1, 2, 3] })
		})

		it('should wrap an empty array too', () => {
			// GIVEN an empty list
			// WHEN normalizing it
			// THEN it is still an object, not a bare array
			expect(toStructuredContent([])).toEqual({ items: [] })
		})
	})

	describe('when the handler returns a value that cannot be a record', () => {
		it('should omit structured output for null', () => {
			// GIVEN a null result (e.g. a missing row) — `null` is not a JSON object
			// WHEN normalizing it
			// THEN structured output is omitted; the field is optional, so no
			//      non-record value reaches the client
			expect(toStructuredContent(null)).toBeUndefined()
		})

		it('should omit structured output for a scalar', () => {
			// GIVEN a scalar result
			// WHEN normalizing a number and a string
			// THEN both omit structured output rather than shipping a non-record
			expect(toStructuredContent(42)).toBeUndefined()
			expect(toStructuredContent('done')).toBeUndefined()
		})

		it('should omit structured output for undefined', () => {
			// GIVEN a handler that returned nothing
			// WHEN normalizing undefined
			// THEN structured output is omitted
			expect(toStructuredContent(undefined)).toBeUndefined()
		})
	})
})

describe('clientFacingMessage', () => {
	describe('when the failure was worded for the caller', () => {
		it('should hand back that wording untouched', () => {
			// GIVEN a failure a tool raised deliberately, to be read and acted on
			// WHEN deciding what the caller is told
			// THEN they are told exactly that
			expect(
				clientFacingMessage(
					new ToolMessage('draft_id is required to send a draft'),
				),
			).toBe('draft_id is required to send a draft')
		})
	})

	describe('when the failure came from somewhere inside the server', () => {
		it('should say nothing about it beyond that it failed', () => {
			// GIVEN a fault carrying database phrasing and an internal path — the
			//       shape an `orDie`'d query error has
			const leak = new Error(
				'permission denied for table member at /app/dist/db-a1b2.mjs',
			)
			// WHEN deciding what the caller is told
			const message = clientFacingMessage(leak)
			// THEN none of it reaches them
			expect(message).not.toContain('permission denied')
			expect(message).not.toContain('member')
			expect(message).not.toContain('/app/dist')
			expect(message).toContain('internal server error')
		})

		it('should say the same for a bare string thrown as a fault', () => {
			// GIVEN a fault that is a plain string rather than an error
			// WHEN deciding what the caller is told
			// THEN it is not forwarded either — only a marked failure is
			expect(clientFacingMessage('raw postgres text')).toContain(
				'internal server error',
			)
		})
	})
})

// Tools covering the shapes the bridge must normalize — a list (bare array), a
// miss (null), an already-valid record — and the two failure kinds: one worded
// for the caller, one an internal fault naming a bundle path.
const ListTool = Tool.make('list_thing', { success: Schema.Unknown })
const MissTool = Tool.make('missing_thing', { success: Schema.Unknown })
const RecordTool = Tool.make('one_thing', { success: Schema.Unknown })
const SpeakingTool = Tool.make('speaking_thing', { success: Schema.Unknown })
const BoomTool = Tool.make('boom_thing', { success: Schema.Unknown })
const SafeTools = Toolkit.make(
	ListTool,
	MissTool,
	RecordTool,
	SpeakingTool,
	BoomTool,
)

const SafeHandlersLive = SafeTools.toLayer(
	Effect.succeed({
		list_thing: () => Effect.succeed([{ id: 'a' }, { id: 'b' }]),
		missing_thing: () => Effect.succeed(null),
		one_thing: () => Effect.succeed({ ok: true }),
		speaking_thing: () =>
			Effect.die(new ToolMessage('footer_id is required to update a footer')),
		boom_thing: () => {
			const err = new Error('provider exploded at /app/dist/thing-9f.mjs')
			err.stack =
				'Error: provider exploded\n    at load (/app/dist/thing-9f.mjs:5:3)'
			return Effect.die(err)
		},
	}),
)

// Every log the server writes while a test runs, so a failure the caller never
// sees can still be shown to have been recorded.
const logged: Array<{ level: string; text: string }> = []
const CaptureLogs = Logger.layer([
	Logger.make(options => {
		logged.push({
			level: String(options.logLevel),
			text: `${JSON.stringify(options.message)} ${String(options.cause ?? '')}`,
		})
	}),
])

const McpHttpLive = mcpToolkitSafe(SafeTools).pipe(
	Layer.provide(SafeHandlersLive),
	Layer.provide(
		McpServer.layerHttp({ name: 'test', version: '1.0.0', path: '/mcp' }),
	),
)

const ServerLive = HttpRouter.serve(McpHttpLive, {
	disableListenLog: true,
}).pipe(
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
	Layer.provideMerge(CaptureLogs),
)

const runtime = ManagedRuntime.make(ServerLive)

type RpcReply = {
	result?: {
		isError?: boolean
		structuredContent?: unknown
		content?: ReadonlyArray<{ type: string; text: string }>
	}
}

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

// The reply comes back either as plain JSON or a single SSE frame; take the last
// `data:` payload when framed, otherwise the whole body.
const readReply = async (res: Response): Promise<RpcReply> => {
	const text = await res.text()
	const dataLine = text
		.split('\n')
		.filter(line => line.startsWith('data:'))
		.at(-1)
	return JSON.parse(dataLine ? dataLine.replace(/^data:\s*/, '') : text)
}

const callTool = (name: string): Promise<Response> =>
	post(
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name, arguments: {} },
		},
		sessionId,
	)

describe('a tool served through mcpToolkitSafe', () => {
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

		const initRes = await post({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'test', version: '1.0' },
			},
		})
		sessionId = initRes.headers.get('mcp-session-id') as string
		if (!sessionId) throw new Error('server did not issue a session id')
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when the handler returns a bare array', () => {
		it('should deliver it as an items record, not a bare array', async () => {
			// WHEN the client calls a list-returning tool
			const reply = await readReply(await callTool('list_thing'))

			// THEN the structured output is an object under `items` a strict
			// client accepts, with the rows intact
			expect(reply.result?.isError).toBeFalsy()
			expect(Array.isArray(reply.result?.structuredContent)).toBe(false)
			expect(reply.result?.structuredContent).toEqual({
				items: [{ id: 'a' }, { id: 'b' }],
			})
		})
	})

	describe('when the handler returns null', () => {
		it('should omit structured output rather than ship a bare null', async () => {
			// WHEN the client calls a tool that finds nothing
			const reply = await readReply(await callTool('missing_thing'))

			// THEN no non-record structured output is sent (the field is absent),
			// so the call is not rejected client-side
			expect(reply.result?.isError).toBeFalsy()
			expect(reply.result?.structuredContent).toBeUndefined()
		})
	})

	describe('when the handler returns a record', () => {
		it('should pass the object through untouched', async () => {
			// WHEN the client calls a record-returning tool
			const reply = await readReply(await callTool('one_thing'))

			// THEN the record is delivered as-is
			expect(reply.result?.structuredContent).toEqual({ ok: true })
		})
	})

	describe('when the handler fails with wording meant for the caller', () => {
		it('should deliver that wording, so the caller can act on it', async () => {
			// WHEN the client calls a tool that refuses for a reason it can state
			const reply = await readReply(await callTool('speaking_thing'))

			// THEN the reason survives intact — this is the whole point of marking
			// it, and without it the caller cannot tell what to send instead
			expect(reply.result?.isError).toBe(true)
			expect(reply.result?.content?.[0]?.text).toBe(
				'footer_id is required to update a footer',
			)
		})
	})

	describe('when the handler dies with an internal error', () => {
		it('should tell the caller nothing about it, but record it', async () => {
			logged.length = 0

			// WHEN the client calls a tool that dies referencing a bundle path
			const reply = await readReply(await callTool('boom_thing'))

			// THEN the call is flagged as an error and the text carries none of it
			expect(reply.result?.isError).toBe(true)
			const text = reply.result?.content?.[0]?.text ?? ''
			expect(text).not.toContain('/app/dist')
			expect(text).not.toContain('.mjs')
			expect(text).not.toContain('provider exploded')

			// AND it reached the server log, named by the tool it came from, so
			// somebody can still answer why the call failed
			const failures = logged.filter(entry => entry.level === 'Error')
			expect(failures.length).toBeGreaterThan(0)
			expect(failures.map(entry => entry.text).join('\n')).toContain(
				'provider exploded',
			)
		})
	})
})
