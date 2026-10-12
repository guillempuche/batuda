// Covers the approval question the way a client on the 2025-06-18 revision gets
// it: through the library's own wire layer, which reshapes the question on the
// way out. A question can be right in our code and wrong by the time it
// arrives, so this asks over a real in-process MCP server and answers it the
// ways a person can.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { McpSchema, McpServer, Tool, Toolkit } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'

import { McpOrgScope } from '../org-scope'
import { MCP_PROTOCOLS } from '../protocols'
import { mcpToolkitSafe } from '../safe-toolkit'
import { requireApproval } from './_elicit'

const AskingTool = Tool.make('asking_thing', {
	success: Schema.String,
	dependencies: [McpSchema.McpServerClient, McpSchema.McpRequestContext],
})
const Tools = Toolkit.make(AskingTool)
const HandlersLive = Tools.toLayer(
	Effect.succeed({ asking_thing: () => requireApproval('Go ahead?') }),
)

const ServerLive = HttpRouter.serve(
	mcpToolkitSafe(Tools).pipe(
		Layer.provide(HandlersLive),
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
	// The tool touches no database, so the org scope it enters passes the work
	// straight through.
	Layer.provide(
		Layer.succeed(McpOrgScope, {
			run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect as Effect.Effect<A, E, Exclude<R, CurrentOrg>>,
		}),
	),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string
let sessionId: string

const post = (body: unknown): Promise<Response> =>
	fetch(`${baseUrl}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
		},
		body: JSON.stringify(body),
	})

type ElicitationRequest = {
	readonly id: number
	readonly params: {
		readonly requestedSchema: {
			readonly properties: Record<string, { readonly type?: string }>
			readonly required?: ReadonlyArray<string>
		}
	}
}

// Calls the tool, answers the question it puts with whatever `reply` builds,
// and returns the question as it arrived beside what the tool answered.
const askAndAnswer = async (
	reply: (question: ElicitationRequest) => unknown,
): Promise<{ question?: ElicitationRequest; answer?: string }> => {
	const callId = Math.floor(Math.random() * 1_000_000)
	const response = await post({
		jsonrpc: '2.0',
		id: callId,
		method: 'tools/call',
		params: { name: 'asking_thing', arguments: {} },
	})
	const reader = response.body?.getReader()
	if (reader === undefined) throw new Error('the call had no body')
	const decoder = new TextDecoder()
	let pending = ''
	let question: ElicitationRequest | undefined
	let result:
		| {
				result?: { content?: ReadonlyArray<{ text: string }> }
				error?: unknown
		  }
		| undefined
	while (result === undefined) {
		const chunk = await reader.read()
		if (chunk.done) break
		pending += decoder.decode(chunk.value)
		const lines = pending.split('\n')
		pending = lines.pop() ?? ''
		for (const line of lines) {
			if (!line.startsWith('data:')) continue
			const message = JSON.parse(line.slice(5))
			if (message.method === 'elicitation/create' && question === undefined) {
				question = message
				await post(reply(message)).then(r => r.text())
			}
			if (message.id === callId) result = message
		}
	}
	// A plain-text answer arrives as the text itself, not quoted as JSON.
	const answer = result?.result?.content?.[0]?.text
	return {
		...(question !== undefined && { question }),
		...(answer !== undefined && { answer }),
	}
}

const accepting = (confirm: unknown) => (question: ElicitationRequest) => ({
	jsonrpc: '2.0',
	id: question.id,
	result: { action: 'accept', content: { confirm } },
})

describe('the approval question on the 2025-06-18 revision', () => {
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
		await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when the question reaches the client', () => {
		it('should ask for a yes or no the client can show as one', async () => {
			// GIVEN a tool that needs the person's say-so
			// WHEN it asks, and the person agrees
			const { question, answer } = await askAndAnswer(accepting(true))

			// THEN the client was handed a true/false field — a free-text field
			// would let an answer like "Yes" through and fail the call — and the
			// agreement cleared the tool to act
			expect(question?.params.requestedSchema.properties['confirm']?.type).toBe(
				'boolean',
			)
			expect(question?.params.requestedSchema.required).toContain('confirm')
			expect(answer).toBe('confirmed')
		})
	})

	describe('when the person answers no', () => {
		it('should report that they declined', async () => {
			// GIVEN the same question
			// WHEN the person answers no
			const { answer } = await askAndAnswer(accepting(false))

			// THEN it is a decision the tool acts on
			expect(answer).toBe('declined')
		})
	})

	describe('when the person closes the question without choosing', () => {
		it('should answer as a no, not as a failure of the server', async () => {
			// GIVEN the same question
			// WHEN the person dismisses it
			const { answer } = await askAndAnswer(question => ({
				jsonrpc: '2.0',
				id: question.id,
				result: { action: 'cancel' },
			}))

			// THEN the tool answers normally with a no, rather than the call ending
			// in an internal error an assistant would retry
			expect(answer).toBe('declined')
		})
	})

	describe('when the client answers the question with an error', () => {
		it('should say there was nobody to ask, not that somebody said no', async () => {
			// GIVEN the same question
			// WHEN the client cannot show it and replies with an error instead
			const { answer } = await askAndAnswer(question => ({
				jsonrpc: '2.0',
				id: question.id,
				error: { code: -32601, message: 'elicitation is not supported' },
			}))

			// THEN nobody decided anything, so the tool is told there was nobody
			// to ask rather than that the answer was no
			expect(answer).toBe('unaskable')
		})
	})
})
