// Covers reading a resource by an address that is not an id. The database
// refuses such a value outright, so it used to come back to the client as the
// driver's own failure text; these answer without asking the database at all.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { McpServer } from 'effect/ai'
import { HttpRouter, HttpServer } from 'effect/http'
import { SqlClient } from 'effect/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CurrentOrg } from '@batuda/controllers'

import { McpOrgScope } from '../org-scope'
import { MCP_PROTOCOLS } from '../protocols'
import { DocumentResource } from './document'
import { TimelineResource } from './timeline'

const ServerLive = HttpRouter.serve(
	Layer.mergeAll(DocumentResource, TimelineResource).pipe(
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
	// The scope passes the work straight through, and the database fails the
	// test if anything reaches it.
	Layer.provide(
		Layer.succeed(McpOrgScope, {
			run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect as Effect.Effect<A, E, Exclude<R, CurrentOrg>>,
		}),
	),
	Layer.provide(
		Layer.succeed(
			SqlClient.SqlClient,
			new Proxy({} as SqlClient.SqlClient, {
				get: () => {
					throw new Error('the database was asked')
				},
				apply: () => {
					throw new Error('the database was asked')
				},
			}),
		),
	),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string
let sessionId: string

const rpc = async (method: string, params: unknown) => {
	const response = await fetch(`${baseUrl}/mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	if (method === 'initialize')
		sessionId = response.headers.get('mcp-session-id') as string
	const text = await response.text()
	const dataLine = text
		.split('\n')
		.filter(line => line.startsWith('data:'))
		.at(-1)
	return JSON.parse(dataLine ? dataLine.replace(/^data:\s*/, '') : text) as {
		result?: { contents?: ReadonlyArray<{ text?: string }> }
		error?: { message: string }
	}
}

describe('reading a resource by an address that is not an id', () => {
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
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when a document is asked for that way', () => {
		it('should say no such document, not show the database refusing', async () => {
			// GIVEN a document address that is not an id
			// WHEN the client reads it
			const reply = await rpc('resources/read', {
				uri: 'batuda://document/not-an-id',
			})

			// THEN it is told the document was not found, as for any missing one
			expect(reply.error?.message).toBe('Document not-an-id not found')
		})
	})

	describe('when a company timeline is asked for that way', () => {
		it('should come back empty, as for a company with no activity', async () => {
			// GIVEN a timeline address whose company is not an id
			// WHEN the client reads it
			const reply = await rpc('resources/read', {
				uri: 'batuda://timeline/not-an-id',
			})

			// THEN there is nothing to list, and the database was never asked
			expect(reply.result?.contents?.[0]?.text).toBe('[]')
		})
	})
})
