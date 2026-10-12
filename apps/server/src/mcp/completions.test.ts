// Covers suggestions as a client asks for them: every prompt argument and every
// resource-template variable the server lists must answer a request for
// suggestions with a list, even an empty one. An argument with no suggester is
// answered with a protocol error, which a client that suggests as you type
// shows on every keystroke. The arguments are read from the server's own lists,
// so one added later without a suggester fails here.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { McpServer } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { McpOrgScope } from './org-scope'
import { MCP_PROTOCOLS } from './protocols'
import { McpResourcesAndPromptsLive } from './server'

const SurfaceLive = McpResourcesAndPromptsLive.pipe(
	Layer.provide(
		McpServer.layerHttp({
			name: 'test',
			version: '1.0.0',
			path: '/mcp',
			protocols: MCP_PROTOCOLS,
		}),
	),
)

const ServerLive = HttpRouter.serve(
	// The services behind the content are never reached: only suggestions are
	// asked for, and those that read the CRM run inside the org scope, which
	// here answers with nothing instead of touching a database.
	SurfaceLive as Layer.Layer<never, never, HttpRouter.HttpRouter>,
	{ disableListenLog: true, disableLogger: true },
).pipe(
	Layer.provide(
		Layer.succeed(McpOrgScope, {
			run: () => Effect.succeed([]) as never,
		}),
	),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string
let sessionId: string
let nextId = 10

const rpc = async (method: string, params: unknown) => {
	const response = await fetch(`${baseUrl}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
	})
	if (method === 'initialize')
		sessionId = response.headers.get('mcp-session-id') as string
	const text = await response.text()
	const dataLine = text
		.split('\n')
		.filter(line => line.startsWith('data:'))
		.at(-1)
	return JSON.parse(dataLine ? dataLine.replace(/^data:\s*/, '') : text) as {
		result?: Record<string, unknown>
		error?: { code: number; message: string }
	}
}

type Ref =
	| { type: 'ref/prompt'; name: string }
	| { type: 'ref/resource'; uri: string }

describe('suggestions for prompt arguments and resource variables', () => {
	const asked: Array<{ ref: Ref; argument: string }> = []

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
		await rpc('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'test', version: '1.0' },
		})

		const prompts = (await rpc('prompts/list', {})).result?.['prompts'] as
			| ReadonlyArray<{
					name: string
					arguments?: ReadonlyArray<{ name: string }>
			  }>
			| undefined
		for (const prompt of prompts ?? [])
			for (const argument of prompt.arguments ?? [])
				asked.push({
					ref: { type: 'ref/prompt', name: prompt.name },
					argument: argument.name,
				})

		const templates = (await rpc('resources/templates/list', {})).result?.[
			'resourceTemplates'
		] as ReadonlyArray<{ uriTemplate: string }> | undefined
		for (const template of templates ?? [])
			for (const [, variable] of template.uriTemplate.matchAll(/\{(\w+)\}/g))
				if (variable !== undefined)
					asked.push({
						ref: { type: 'ref/resource', uri: template.uriTemplate },
						argument: variable,
					})
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when a client asks for suggestions on any of them', () => {
		it('should answer every one with a list rather than an error', async () => {
			// GIVEN every argument and variable the server itself lists
			expect(asked.length).toBeGreaterThan(10)

			// WHEN suggestions are asked for each, as a client does while typing
			const refused: Array<string> = []
			for (const { ref, argument } of asked) {
				const reply = await rpc('completion/complete', {
					ref,
					argument: { name: argument, value: '' },
				})
				const values = (
					reply.result?.['completion'] as { values?: unknown } | undefined
				)?.values
				if (reply.error !== undefined || !Array.isArray(values))
					refused.push(
						`${ref.type === 'ref/prompt' ? ref.name : ref.uri} ${argument}`,
					)
			}

			// THEN none is turned away
			expect(refused).toEqual([])
		})

		it('should offer the languages a prompt writes in', async () => {
			// GIVEN a prompt that takes a language
			// WHEN suggestions are asked for its language with a first letter typed
			const reply = await rpc('completion/complete', {
				ref: { type: 'ref/prompt', name: 'daily-briefing' },
				argument: { name: 'lang', value: 'c' },
			})

			// THEN the matching language is offered
			const completion = reply.result?.['completion'] as
				| { values?: unknown }
				| undefined
			expect(completion?.values).toEqual(['ca'])
		})
	})
})
