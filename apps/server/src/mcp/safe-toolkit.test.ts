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
import {
	Effect,
	Exit,
	Layer,
	Logger,
	ManagedRuntime,
	References,
	Schema,
} from 'effect'
import { McpServer, Tool, Toolkit } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'
import { makeWorkRecord, WorkRecord } from '@batuda/observability'

import { McpOrgScope } from './org-scope'
import { MCP_PROTOCOLS } from './protocols'
import {
	clientFacingMessage,
	isExpectedFailure,
	mcpToolkitSafe,
} from './safe-toolkit'
import { ToolMessage } from './tool-message'

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

describe('isExpectedFailure', () => {
	const causeOf = (effect: Effect.Effect<never, unknown>) => {
		const exit = Effect.runSyncExit(effect)
		if (!Exit.isFailure(exit)) throw new Error('expected the effect to fail')
		return exit.cause
	}

	describe('when the tool said what it could not do', () => {
		it('should call it an expected answer', () => {
			// GIVEN a tool that stopped with wording written for the caller — the
			// shape every "no such thing" answer has
			// WHEN deciding whether it went wrong
			// THEN it did not
			expect(
				isExpectedFailure(
					causeOf(Effect.die(new ToolMessage('No EmailDraft with id d_1.'))),
				),
			).toBe(true)
		})
	})

	describe('when something inside the server broke', () => {
		it('should call an internal fault unexpected', () => {
			// GIVEN a fault nobody wrote for the caller
			// WHEN deciding whether it went wrong
			// THEN it did
			expect(
				isExpectedFailure(causeOf(Effect.die(new Error('connection reset')))),
			).toBe(false)
		})

		it('should call a bare string unexpected', () => {
			// GIVEN a fault that is not even an error object
			// WHEN deciding whether it went wrong
			// THEN it did — only a marked failure counts as expected
			expect(isExpectedFailure(causeOf(Effect.die('raw postgres text')))).toBe(
				false,
			)
		})

		it('should call an ordinary failure unexpected', () => {
			// GIVEN a tool that failed rather than stopping deliberately
			// WHEN deciding whether it went wrong
			// THEN it did
			expect(
				isExpectedFailure(causeOf(Effect.fail(new Error('query timed out')))),
			).toBe(false)
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
const TaggedTool = Tool.make('tagged_thing', { success: Schema.Unknown })
const SparseTool = Tool.make('sparse_thing', { success: Schema.Unknown })
const CountingTool = Tool.make('counting_thing', { success: Schema.Unknown })
const NamingTool = Tool.make('naming_thing', {
	parameters: Schema.Struct({ name: Schema.String }),
	success: Schema.Unknown,
})
const SafeTools = Toolkit.make(
	NamingTool,
	ListTool,
	MissTool,
	RecordTool,
	SpeakingTool,
	BoomTool,
	TaggedTool,
	SparseTool,
	CountingTool,
)

const SafeHandlersLive = SafeTools.toLayer(
	Effect.succeed({
		list_thing: () => Effect.succeed([{ id: 'a' }, { id: 'b' }]),
		missing_thing: () => Effect.succeed(null),
		one_thing: () => Effect.succeed({ ok: true }),
		sparse_thing: () => Effect.succeed({ ok: true, note: undefined }),
		counting_thing: () => Effect.succeed({ total: 3n }),
		naming_thing: ({ name }) => Effect.succeed({ name }),
		speaking_thing: () =>
			Effect.die(new ToolMessage('footer_id is required to update a footer')),
		tagged_thing: () => Effect.succeed({ _tag: 'suppressed', recipient: 'x' }),
		boom_thing: () => {
			const err = new Error('provider exploded at /app/dist/thing-9f.mjs')
			err.stack =
				'Error: provider exploded\n    at load (/app/dist/thing-9f.mjs:5:3)'
			return Effect.die(err)
		},
	}),
)

// Every log the server writes while a test runs, so a failure the caller never
// sees can still be shown to have been recorded. Debug lines are kept too, or
// the difference between a fault and an ordinary answer could not be seen.
const logged: Array<{ level: string; text: string }> = []
const CaptureLogs = Logger.layer([
	Logger.make(options => {
		logged.push({
			level: String(options.logLevel),
			text: `${JSON.stringify(options.message)} ${String(options.cause ?? '')}`,
		})
	}),
]).pipe(Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, 'Debug')))

// The record a request opens in production, opened here for the whole server
// instead so the test can read what a call wrote onto it. Facts refine rather
// than accumulate, so each call leaves the latest answer under the same keys.
const workRecord = Effect.runSync(makeWorkRecord)
const factsNow = () => Effect.runSync(workRecord.read)

const McpHttpLive = mcpToolkitSafe(SafeTools).pipe(
	Layer.provide(SafeHandlersLive),
	Layer.provide(
		McpServer.layerHttp({
			name: 'test',
			version: '1.0.0',
			path: '/mcp',
			protocols: MCP_PROTOCOLS,
		}),
	),
)

const ServerLive = HttpRouter.serve(McpHttpLive, {
	disableListenLog: true,
}).pipe(
	// These tools touch no database, so the org scope they enter passes the
	// work straight through.
	Layer.provide(
		Layer.succeed(McpOrgScope, {
			run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect as Effect.Effect<A, E, Exclude<R, CurrentOrg>>,
		}),
	),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
	Layer.provideMerge(CaptureLogs),
	Layer.provideMerge(Layer.succeed(WorkRecord, workRecord)),
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

const callTool = (
	name: string,
	args: Record<string, unknown> = {},
): Promise<Response> =>
	post(
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name, arguments: args },
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
		if (address._tag === 'UnixPathAddress')
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

	describe('when a tool has answered, however it answered', () => {
		it('should leave the tool’s name and how it went on the request’s record', async () => {
			// WHEN a tool answers normally
			await callTool('one_thing')

			// THEN the record says which tool ran and that it went fine. A tool
			// call is a JSON-RPC payload inside an ordinary 200, so without this
			// the only line the request leaves cannot say what was called
			expect(factsNow()['mcp.tool']).toBe('one_thing')
			expect(factsNow()['mcp.tool.outcome']).toBe('ok')
		})

		it('should mark a refusal as the tool answering, not as a fault', async () => {
			// WHEN a tool refuses in words meant for the caller
			await callTool('speaking_thing')

			// THEN the record says refused. This is the outcome that was
			// invisible: the client shows it as a silent retry, and the request
			// still ended 200, so nothing anywhere said a caller had been turned
			// away
			expect(factsNow()['mcp.tool']).toBe('speaking_thing')
			expect(factsNow()['mcp.tool.outcome']).toBe('refused')
		})

		it('should name the tag on an answer that turned the caller away', async () => {
			// WHEN a tool answers with a refusal carrying a tag, the way a send
			// reports a suppressed recipient
			await callTool('tagged_thing')

			// THEN the tag is on the record. The call succeeded, so the outcome
			// is ok and would count it as an answer — most of the refusals worth
			// counting arrive in this shape rather than as a failure
			expect(factsNow()['mcp.tool.outcome']).toBe('ok')
			expect(factsNow()['mcp.tool.answer']).toBe('suppressed')
		})

		it('should mark an internal fault apart from a refusal', async () => {
			// WHEN a tool breaks in a way nobody intended
			await callTool('boom_thing')

			// THEN the record says failed rather than refused — counting the two
			// together would bury the faults among ordinary answers, which is the
			// same reason the log level differs
			expect(factsNow()['mcp.tool']).toBe('boom_thing')
			expect(factsNow()['mcp.tool.outcome']).toBe('failed')
		})
	})

	describe('when the handler returns a bare array', () => {
		it('should leave structured output off and carry the rows in the text', async () => {
			// WHEN the client calls a list-returning tool
			const reply = await readReply(await callTool('list_thing'))

			// THEN no bare array reaches structured output, which strict clients
			// reject, and the rows still arrive in the text block
			expect(reply.result?.isError).toBeFalsy()
			expect(reply.result?.structuredContent).toBeUndefined()
			expect(reply.result?.content?.[0]?.text).toBe(
				JSON.stringify([{ id: 'a' }, { id: 'b' }]),
			)
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

		it('should deliver a count the database gave as a bigint as a number', async () => {
			// GIVEN a tool answering with a raw count, which arrives as a bigint
			// WHEN the client calls it
			const reply = await readReply(await callTool('counting_thing'))

			// THEN the call answers with the number rather than failing to write it
			expect(reply.result?.isError).toBeFalsy()
			expect(reply.result?.structuredContent).toEqual({ total: 3 })
		})

		it('should deliver a record holding an unset key the way the wire carries it', async () => {
			// GIVEN a tool whose answer leaves one optional key unset
			// WHEN the client calls it
			const reply = await readReply(await callTool('sparse_thing'))

			// THEN the call answers rather than failing on a value that is not
			// JSON, and the unset key is simply absent
			expect(reply.result?.isError).toBeFalsy()
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

		it('should not record it as something that went wrong', async () => {
			logged.length = 0

			// WHEN the client calls a tool that answers with a stated reason —
			// "no draft with that id" is what most of these say, and there are
			// far more of those than there are faults
			await readReply(await callTool('speaking_thing'))

			// THEN nothing lands in the error log: the tool did what it was asked
			// and said so, and filing that as a fault buries the real ones
			expect(logged.filter(entry => entry.level === 'Error')).toEqual([])

			// AND it is still written down, named by the tool it came from, so it
			// can be found when somebody goes looking
			const debug = logged.filter(entry => entry.level === 'Debug')
			expect(debug.length).toBeGreaterThan(0)
			expect(debug.map(entry => entry.text).join('\n')).toContain(
				'footer_id is required to update a footer',
			)
		})
	})

	describe('when a client lists the tools', () => {
		it('should describe each tool’s arguments as closed to keys it does not name', async () => {
			// WHEN the client asks which tools there are
			const reply = (await readReply(
				await post(
					{ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
					sessionId,
				),
			)) as {
				result?: {
					tools?: ReadonlyArray<{
						name: string
						inputSchema: Record<string, unknown>
					}>
				}
			}

			// THEN a tool's arguments say no other key belongs — the hint that
			// keeps a model from inventing arguments
			const naming = reply.result?.tools?.find(
				tool => tool.name === 'naming_thing',
			)
			expect(naming?.inputSchema['additionalProperties']).toBe(false)
			expect(naming?.inputSchema['required']).toEqual(['name'])
		})

		it('should still answer a call that sends a key it does not name', async () => {
			// GIVEN a client that sends an extra key, as some do
			// WHEN it calls the tool
			const reply = await readReply(
				await callTool('naming_thing', { name: 'acme', extra: 1 }),
			)

			// THEN the extra key is ignored rather than refused
			expect(reply.result?.isError).toBeFalsy()
			expect(reply.result?.structuredContent).toEqual({ name: 'acme' })
		})
	})

	describe('when the arguments do not fit the tool', () => {
		it('should tell the caller what was wrong and not record it as a fault', async () => {
			logged.length = 0

			// WHEN the client calls a tool without an argument it requires
			const reply = await readReply(await callTool('naming_thing'))

			// THEN the caller is told which argument was wrong
			expect(reply.result?.isError).toBe(true)
			expect(reply.result?.content?.[0]?.text).toContain('name')

			// AND it counts as the call being turned away, not as something that
			// broke, so the error log keeps holding only what nobody expected
			expect(factsNow()['mcp.tool.outcome']).toBe('refused')
			expect(logged.filter(entry => entry.level === 'Error')).toEqual([])
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
