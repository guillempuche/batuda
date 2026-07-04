// Covers the two client-facing defects mcpToolkitSafe corrects (issue #168), at
// two levels: the unit blocks feed the shaping helpers (toStructuredContent,
// sanitizeCause) the shapes that handlers actually produce; the round-trip block
// drives tools registered with mcpToolkitSafe over a real in-process MCP HTTP
// server and asserts what the client receives, so a future effect release that
// changes the bridge's result/error rendering fails here rather than in prod.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/unstable/ai'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	mcpToolkitSafe,
	sanitizeCause,
	toStructuredContent,
} from './safe-toolkit'

// Render the cause of a failing effect the way the MCP bridge does, so the
// tests exercise sanitizeCause against a real Cause (not a hand-built one).
const causeOf = (
	effect: Effect.Effect<unknown, unknown>,
): Cause.Cause<unknown> => {
	const exit = Effect.runSyncExit(effect)
	if (Exit.isFailure(exit)) return exit.cause
	throw new Error('expected the effect to fail')
}

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

describe('sanitizeCause', () => {
	describe('when the effect dies with a redacted string defect', () => {
		it('should surface the string without decoration', () => {
			// GIVEN a defect that is already a safe string (as redactDbErrors emits)
			const cause = causeOf(Effect.die('internal error'))
			// WHEN sanitizing it for the client
			// THEN the message is preserved verbatim
			expect(sanitizeCause(cause)).toBe('internal error')
		})
	})

	describe('when the effect dies with an Error carrying a stack and bundle path', () => {
		it('should not leak the stack, bundle path, or nested cause', () => {
			// GIVEN an Error whose message and stack reference an internal bundle
			const err = new Error(
				'read failed at /app/dist/s3-storage-provider-a1b2.mjs',
			)
			err.stack =
				'Error: read failed\n    at load (/app/dist/s3-storage-provider-a1b2.mjs:12:9)\n    at run (/app/dist/index.mjs:3:1)'
			const cause = causeOf(Effect.die(err))

			// WHEN sanitizing it for the client
			const rendered = sanitizeCause(cause)

			// THEN no bundle path, no `.mjs`, and no stack frame survives
			expect(rendered).not.toContain('/app/dist')
			expect(rendered).not.toContain('.mjs')
			expect(rendered).not.toMatch(/\n\s*at\s/)
			// AND the caller still gets a short, human-readable signal
			expect(rendered).toContain('read failed')
			expect(rendered.length).toBeLessThanOrEqual(500)
		})
	})

	describe('when the message embeds a non-JavaScript absolute path', () => {
		it('should redact the path regardless of its extension', () => {
			// GIVEN a filesystem error naming an internal secret path
			const cause = causeOf(
				Effect.die(new Error("ENOENT: open '/app/secrets/key.pem'")),
			)
			// WHEN sanitizing it
			const rendered = sanitizeCause(cause)
			// THEN the path is gone even though it does not end in .js/.ts
			expect(rendered).not.toContain('/app/secrets')
			expect(rendered).not.toContain('.pem')
		})

		it('should leave a URL in the message intact', () => {
			// GIVEN a scraping failure that names the URL it hit — useful signal
			const cause = causeOf(
				Effect.die(new Error('fetch failed for https://example.com/a/b/c')),
			)
			// WHEN sanitizing it
			// THEN the URL survives; only server filesystem paths are redacted
			expect(sanitizeCause(cause)).toContain('https://example.com/a/b/c')
		})
	})

	describe('when the message is a long slash-heavy string', () => {
		it('should redact it without pathological backtracking', () => {
			// GIVEN a message with many path segments and no file extension —
			// the shape that made the previous regex backtrack exponentially
			const segments = `/${Array.from({ length: 60 }, (_, i) => `seg${i}`).join('/')}`
			const cause = causeOf(Effect.die(new Error(`fetch failed ${segments}`)))
			// WHEN sanitizing it (this returns promptly; a hang would fail the run)
			const rendered = sanitizeCause(cause)
			// THEN the path is redacted
			expect(rendered).toContain('<path>')
			expect(rendered).not.toContain('/seg59')
		})
	})

	describe('when the effect fails with a tagged domain error', () => {
		it('should surface the tag and message but nothing more', () => {
			// GIVEN a tagged error the way a provider failure would surface
			const cause = causeOf(
				Effect.fail({
					_tag: 'ProviderError',
					message: 'no credit remaining',
				}),
			)
			// WHEN sanitizing it
			// THEN the client sees the tag and message, useful but internals-free
			expect(sanitizeCause(cause)).toBe('ProviderError: no credit remaining')
		})
	})

	describe('when the cause carries no renderable error', () => {
		it('should fall back to a generic message', () => {
			// GIVEN an empty cause (no failure or defect to render)
			// WHEN sanitizing it
			// THEN a generic, safe message is returned rather than an empty string
			expect(sanitizeCause(Cause.empty)).toBe('internal error')
		})
	})
})

// Four tools covering the shapes the bridge must normalize: a list (bare array),
// a miss (null), an already-valid record, and a failure that dies with an Error
// whose message and stack reference an internal bundle path.
const ListTool = Tool.make('list_thing', { success: Schema.Unknown })
const MissTool = Tool.make('missing_thing', { success: Schema.Unknown })
const RecordTool = Tool.make('one_thing', { success: Schema.Unknown })
const BoomTool = Tool.make('boom_thing', { success: Schema.Unknown })
const SafeTools = Toolkit.make(ListTool, MissTool, RecordTool, BoomTool)

const SafeHandlersLive = SafeTools.toLayer(
	Effect.succeed({
		list_thing: () => Effect.succeed([{ id: 'a' }, { id: 'b' }]),
		missing_thing: () => Effect.succeed(null),
		one_thing: () => Effect.succeed({ ok: true }),
		boom_thing: () => {
			const err = new Error('provider exploded at /app/dist/thing-9f.mjs')
			err.stack =
				'Error: provider exploded\n    at load (/app/dist/thing-9f.mjs:5:3)'
			return Effect.die(err)
		},
	}),
)

const McpHttpLive = mcpToolkitSafe(SafeTools).pipe(
	Layer.provide(SafeHandlersLive),
	Layer.provide(
		McpServer.layerHttp({ name: 'test', version: '1.0.0', path: '/mcp' }),
	),
)

const ServerLive = HttpRouter.serve(McpHttpLive, {
	disableListenLog: true,
}).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))

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

	describe('when the handler dies with an internal error', () => {
		it('should return a sanitized message with no stack or bundle path', async () => {
			// WHEN the client calls a tool that dies referencing a bundle path
			const reply = await readReply(await callTool('boom_thing'))

			// THEN the call is flagged as an error but the text leaks no internals
			expect(reply.result?.isError).toBe(true)
			const text = reply.result?.content?.[0]?.text ?? ''
			expect(text).not.toContain('/app/dist')
			expect(text).not.toContain('.mjs')
			expect(text).not.toMatch(/\n\s*at\s/)
			// AND the caller still gets a usable signal
			expect(text).toContain('provider exploded')
		})
	})
})
