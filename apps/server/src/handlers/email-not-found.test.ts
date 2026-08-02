// What the web answers when the thing asked for is not there.
//
// Worth a whole in-process server: the difference between "no such draft" and
// "the server broke" is invisible to the compiler. Wiring a refusal one way
// answers 404 and wiring it another answers 500, and both spell correctly, so
// only a real request through the real routes can tell them apart.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	CurrentOrg,
	EmailGroup,
	NotFound,
	OrgMiddleware,
	SessionContext,
	SessionMiddleware,
} from '@batuda/controllers'

import { EmailService } from '../services/email'
import { EmailAttachmentStaging } from '../services/email-attachment-staging'
import { EmailLive } from './email'

// The mail routes on their own. The whole application would drag in every
// other area's database work for a question that is only about these. It has
// to keep the application's own name, which is what lets the real mail
// handlers below be mounted on it rather than a rewritten copy of them.
const MailOnly = HttpApi.make('BatudaApi').add(EmailGroup)

// Somebody signed in and acting in an organization, taken as given — who they
// are is settled elsewhere and is not what these requests are about.
const signedIn = Layer.succeed(
	SessionMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, SessionContext, {
			userId: 'not-found-test-user',
			email: 'not-found-test@test.local',
			name: undefined,
			isAgent: false,
		}),
)

const actingInAnOrg = Layer.succeed(
	OrgMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, CurrentOrg, {
			id: 'not-found-test-org',
			name: 'Not Found Test',
			slug: 'not-found-test',
			role: 'member',
		}),
)

// A mail service where nothing the caller names is ever there — which is the
// only situation these requests are about.
const nothingIsThere = Layer.succeed(EmailService, {
	getDraft: (_inboxId: string, draftId: string) =>
		Effect.fail(new NotFound({ entity: 'EmailDraft', id: draftId })),
	updateDraft: (_inboxId: string, draftId: string) =>
		Effect.fail(new NotFound({ entity: 'EmailDraft', id: draftId })),
	deleteDraft: (_inboxId: string, draftId: string) =>
		Effect.fail(new NotFound({ entity: 'EmailDraft', id: draftId })),
	sendDraft: (_inboxId: string, draftId: string) =>
		Effect.fail(new NotFound({ entity: 'EmailDraft', id: draftId })),
	createDraft: (inboxId: string) =>
		Effect.fail(new NotFound({ entity: 'Inbox', id: inboxId })),
	deleteInbox: (inboxId: string) =>
		Effect.fail(new NotFound({ entity: 'Inbox', id: inboxId })),
} as never)

const ServerLive = HttpRouter.serve(
	HttpApiBuilder.layer(MailOnly).pipe(
		Layer.provide(EmailLive),
		Layer.provide([signedIn, actingInAnOrg]),
		Layer.provide([
			nothingIsThere,
			Layer.succeed(EmailAttachmentStaging, {} as never),
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

// Every way of asking the web about one piece of mail. Adding another is one
// line: the method, the address, whatever the request carries, and the kind of
// thing the caller named that turned out not to be there.
const asking: ReadonlyArray<{
	readonly what: string
	readonly method: string
	readonly path: string
	readonly body?: unknown
	readonly entity: string
	readonly id: string
}> = [
	{
		what: 'reading a draft',
		method: 'GET',
		path: '/v1/email/drafts/no-such-draft?inboxId=some-inbox',
		entity: 'EmailDraft',
		id: 'no-such-draft',
	},
	{
		what: 'changing a draft',
		method: 'PATCH',
		path: '/v1/email/drafts/no-such-draft',
		body: { inboxId: 'some-inbox' },
		entity: 'EmailDraft',
		id: 'no-such-draft',
	},
	{
		what: 'throwing a draft away',
		method: 'DELETE',
		path: '/v1/email/drafts/no-such-draft?inboxId=some-inbox',
		entity: 'EmailDraft',
		id: 'no-such-draft',
	},
	{
		what: 'sending a draft',
		method: 'POST',
		path: '/v1/email/drafts/no-such-draft/send',
		body: { inboxId: 'some-inbox' },
		entity: 'EmailDraft',
		id: 'no-such-draft',
	},
	{
		what: 'starting a draft in a mailbox that is not there',
		method: 'POST',
		path: '/v1/email/drafts',
		body: { inboxId: 'no-such-inbox' },
		entity: 'Inbox',
		id: 'no-such-inbox',
	},
	{
		what: 'disconnecting a mailbox that is not there',
		method: 'DELETE',
		path: '/v1/email/inboxes/no-such-inbox',
		entity: 'Inbox',
		id: 'no-such-inbox',
	},
]

describe('the mail routes', () => {
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
	}, 30_000)

	afterAll(() => runtime.dispose())

	describe('when the thing named is not there', () => {
		for (const { what, method, path, body, entity, id } of asking) {
			it(`should answer ${what} with a 404 rather than a breakage`, async () => {
				// GIVEN a mailbox and a draft that do not exist
				// WHEN the caller asks anyway
				const response = await request(method, path, body)

				// THEN the answer is "not there" — a 500 would say the server
				// broke, which sends whoever is watching to look for a fault
				// there is none of, and tells the person nothing they can act on
				expect(response.status).toBe(404)

				// AND it says which of the things they named was missing, so
				// they can tell a wrong draft id from a wrong mailbox id
				expect(await response.json()).toEqual({ _tag: 'NotFound', entity, id })
			})
		}
	})
})
