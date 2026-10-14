// What the web answers when the id in the address is not an id at all.
//
// Records here are keyed by uuid. Text that is not one used to reach the
// database, which refused it, and the caller was told the server broke. The
// route now refuses it first. Only a real request through the real routes shows
// which answer comes back, so this runs an in-process server whose services
// fail the test if anything reaches them.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder } from 'effect/http-api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	CurrentOrg,
	OrgMiddleware,
	SessionContext,
	SessionMiddleware,
	TasksGroup,
	WebhooksGroup,
} from '@batuda/controllers'

import { TaskService } from '../services/tasks'
import { WebhookService } from '../services/webhooks'
import { TasksLive } from './tasks'
import { WebhooksLive } from './webhooks'

// Two areas whose routes all take a record id, each with a service of its own,
// so nothing else has to be stood up. They keep the application's own name,
// which is what lets the real handlers be mounted on them.
const Api = HttpApi.make('BatudaApi').add(TasksGroup).add(WebhooksGroup)

const signedIn = Layer.succeed(
	SessionMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, SessionContext, {
			userId: 'malformed-id-test-user',
			email: 'malformed-id-test@test.local',
			name: undefined,
			isAgent: false,
		}),
)

const actingInAnOrg = Layer.succeed(
	OrgMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, CurrentOrg, {
			id: 'malformed-id-test-org',
			name: 'Malformed Id Test',
			slug: 'malformed-id-test',
			role: 'member',
		}),
)

// Any method called on these is a request that got past the route, which is
// exactly what must not happen here.
const reached: Array<string> = []
const tripwire = (service: string) =>
	new Proxy(
		{},
		{
			get: (_target, method) => () => {
				reached.push(`${service}.${String(method)}`)
				return Effect.die(new Error('the route let a malformed id through'))
			},
		},
	) as never

const ServerLive = HttpRouter.serve(
	HttpApiBuilder.layer(Api).pipe(
		Layer.provide([TasksLive, WebhooksLive]),
		Layer.provide([signedIn, actingInAnOrg]),
		Layer.provide([
			Layer.succeed(TaskService, tripwire('TaskService')),
			Layer.succeed(WebhookService, tripwire('WebhookService')),
		]),
	),
	{ disableListenLog: true },
).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string

const request = (method: string, path: string, body?: unknown) =>
	fetch(`${baseUrl}${path}`, {
		method,
		...(body !== undefined && {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	})

const asking: ReadonlyArray<{
	readonly what: string
	readonly method: string
	readonly path: string
	readonly body?: unknown
}> = [
	{ what: 'reading a task', method: 'GET', path: '/v1/tasks/not-a-uuid' },
	{
		what: 'changing a task',
		method: 'PATCH',
		path: '/v1/tasks/not-a-uuid',
		body: {},
	},
	{
		what: 'completing a task',
		method: 'POST',
		path: '/v1/tasks/not-a-uuid/complete',
		body: {},
	},
	{
		what: 'reading what happened to a task',
		method: 'GET',
		path: '/v1/tasks/1234/events',
	},
	{
		what: 'changing a webhook',
		method: 'PATCH',
		path: '/v1/webhooks/not-a-uuid',
		body: {},
	},
	{
		what: 'removing a webhook',
		method: 'DELETE',
		path: '/v1/webhooks/not-a-uuid',
	},
]

describe('routes keyed by a record id', () => {
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
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when the id in the address is not a uuid', () => {
		for (const { what, method, path, body } of asking) {
			it(`should refuse ${what} with a 400 rather than a breakage`, async () => {
				// GIVEN an address whose id could never name a record
				reached.length = 0

				// WHEN the caller sends it anyway
				const response = await request(method, path, body)

				// THEN the request is refused as the caller's mistake — a 500 would
				// send whoever is watching to look for a fault there is none of
				expect(response.status).toBe(400)

				// AND nothing behind the route was asked, so no query ran
				expect(reached).toEqual([])
			})
		}
	})
})
