// What the web accepts on a link, and what it turns away.
//
// Worth a whole in-process server: a filter that reaches the service under the
// wrong name quietly stops narrowing anything, and a value nobody checks —
// `?status=delivered`, a date that is not a date — comes back as an empty page,
// which reads as "you have none of those" rather than "that is not a status".
// Only a real request through the real routes can tell those apart.
//
// The mail service is a stand-in that records what it was asked for, because
// the question here is the wire, not the database.

import { createServer } from 'node:http'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	CurrentOrg,
	EmailGroup,
	OrgMiddleware,
	SessionContext,
	SessionMiddleware,
} from '@batuda/controllers'

import { EmailService } from '../services/email'
import { EmailAttachmentStaging } from '../services/email-attachment-staging'
import { EmailLive } from './email'

const MailOnly = HttpApi.make('BatudaApi').add(EmailGroup)

const signedIn = Layer.succeed(
	SessionMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, SessionContext, {
			userId: 'list-query-user',
			email: 'list-query@test.local',
			name: undefined,
			isAgent: false,
		}),
)

const actingInAnOrg = Layer.succeed(
	OrgMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, CurrentOrg, {
			id: 'list-query-org',
			name: 'List Query Test',
			slug: 'list-query-test',
			role: 'member',
		}),
)

/** What the last request asked the service for. */
let askedForThreads: Record<string, unknown> | null = null
let askedForMessages: Record<string, unknown> | null = null

const emptyPage = {
	items: [],
	total: null,
	limit: 100,
	offset: 0,
	hasMore: false,
}

const recordingService = Layer.succeed(EmailService, {
	listThreads: (filters: Record<string, unknown>) => {
		askedForThreads = filters
		return Effect.succeed(emptyPage)
	},
	listMessages: (filters: Record<string, unknown>) => {
		askedForMessages = filters
		return Effect.succeed(emptyPage)
	},
} as never)

const ServerLive = HttpRouter.serve(
	HttpApiBuilder.layer(MailOnly).pipe(
		Layer.provide(EmailLive),
		Layer.provide([signedIn, actingInAnOrg]),
		Layer.provide([
			recordingService,
			Layer.succeed(EmailAttachmentStaging, {} as never),
		]),
	),
	{ disableListenLog: true },
).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))

const runtime = ManagedRuntime.make(ServerLive)
let baseUrl: string

const get = (path: string) => fetch(`${baseUrl}${path}`)

beforeAll(async () => {
	const address = await runtime.runPromise(
		Effect.gen(function* () {
			const server = yield* HttpServer.HttpServer
			return server.address
		}),
	)
	if (address._tag !== 'TcpAddress') throw new Error('expected a TCP address')
	baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
	await runtime.dispose()
})

describe('GET /v1/email/threads [routes/email.ts]', () => {
	describe('when nothing is asked for', () => {
		it('should hand the service no filters at all', async () => {
			// GIVEN a plain request
			askedForThreads = null
			// WHEN it is made
			const response = await get('/v1/email/threads')
			// THEN the service is asked for everything, with no stray keys
			expect(response.status).toBe(200)
			expect(Object.keys(askedForThreads ?? {})).toEqual([])
		})
	})

	describe('when each filter is named the way a link names it', () => {
		it('should reach the service under the name it reads', async () => {
			// GIVEN every filter on one link
			askedForThreads = null
			// WHEN the request is made
			const response = await get(
				'/v1/email/threads?status=open,closed&waitingOn=us&unread=true' +
					'&quietDays=14&hasAttachments=false&companyOwner=none,user-1' +
					'&sort=latest_message&contactId=c1&inboxId=i1&companyId=co1&query=roof' +
					'&lastMessageAfter=2026-09-01&lastMessageBefore=2026-09-30',
			)
			// THEN each one arrives, read into the shape the service expects
			expect(response.status).toBe(200)
			expect(askedForThreads).toMatchObject({
				status: ['open', 'closed'],
				waitingOn: 'us',
				unread: true,
				quietDays: 14,
				hasAttachments: false,
				companyOwner: ['none', 'user-1'],
				sort: 'latest_message',
				contactId: 'c1',
				inboxId: 'i1',
				companyId: 'co1',
				query: 'roof',
				lastMessageAfter: '2026-09-01',
				lastMessageBefore: '2026-09-30',
			})
		})
	})

	describe('when a value is not one the app has', () => {
		it.each([
			['a stage nobody has', 'status=open,bogus'],
			['a made-up waiting_on', 'waitingOn=me'],
			['a made-up order', 'sort=oldest'],
			['a yes/no written another way', 'unread=1'],
			['a yes/no in capitals', 'hasAttachments=TRUE'],
		])('should refuse %s', async (_why, query) => {
			// GIVEN a link carrying a value the app does not have
			// WHEN the request is made
			const response = await get(`/v1/email/threads?${query}`)
			// THEN it is turned away rather than answered with an empty page
			expect(response.status).toBe(400)
		})
	})

	describe('when the quiet-days number is out of bounds', () => {
		it.each([
			'0',
			'3651',
			'7.5',
			'abc',
			'',
		])('should refuse %s', async value => {
			// GIVEN a number of days nobody can mean
			// WHEN the request is made
			const response = await get(`/v1/email/threads?quietDays=${value}`)
			// THEN it is turned away
			expect(response.status).toBe(400)
		})

		it.each(['1', '3650'])('should accept %s', async value => {
			// GIVEN a number at the edge of what is allowed
			// WHEN the request is made
			const response = await get(`/v1/email/threads?quietDays=${value}`)
			// THEN it goes through
			expect(response.status).toBe(200)
		})
	})

	describe('when the dates cannot be read or cross over', () => {
		it.each([
			['a date that is not one', 'lastMessageAfter=nope'],
			['a day that is not on the calendar', 'lastMessageAfter=2026-02-30'],
			['a moment with no timezone', 'lastMessageAfter=2026-09-01T00:00:00'],
			[
				'the same moment on both sides',
				'lastMessageAfter=2026-09-01&lastMessageBefore=2026-09-01',
			],
			[
				'bounds the wrong way round',
				'lastMessageAfter=2026-09-30&lastMessageBefore=2026-09-01',
			],
		])('should refuse %s in words', async (_why, query) => {
			// GIVEN a range that cannot be read, or can only find nothing
			// WHEN the request is made
			const response = await get(`/v1/email/threads?${query}`)
			const body = (await response.json()) as { message?: string }
			// THEN the answer says what is wrong, rather than being an empty page
			expect(response.status).toBe(400)
			expect(body.message ?? '').not.toBe('')
		})
	})

	describe('when an address is put on the link', () => {
		it('should not be a filter the web takes', async () => {
			// GIVEN a link trying to filter by address, which only the tools take
			askedForThreads = null
			// WHEN the request is made
			await get('/v1/email/threads?participant=ana@acme.test')
			// THEN it reaches the service as nothing: addresses stay out of URLs,
			// where they would end up in logs and browsing history
			expect(askedForThreads).toEqual({})
		})
	})
})

describe('GET /v1/email/messages [routes/email.ts]', () => {
	describe('when each filter is named the way a link names it', () => {
		it('should reach the service under the name it reads', async () => {
			// GIVEN every message filter on one link
			askedForMessages = null
			// WHEN the request is made
			const response = await get(
				'/v1/email/messages?status=normal,bounced&direction=outbound' +
					'&bounceType=hard&inboxId=i1&receivedAfter=2026-09-01' +
					'&receivedBefore=2026-09-30&query=invoice',
			)
			// THEN each arrives under its own name
			expect(response.status).toBe(200)
			expect(askedForMessages).toMatchObject({
				status: ['normal', 'bounced'],
				direction: 'outbound',
				bounceType: 'hard',
				inboxId: 'i1',
				receivedAfter: '2026-09-01',
				receivedBefore: '2026-09-30',
				query: 'invoice',
			})
		})
	})

	describe('when a value names something the database never stores', () => {
		it.each([
			['a status from another system', 'status=delivered'],
			['a refusal that is neither hard nor soft', 'bounceType=unknown'],
			['a direction nobody has', 'direction=sideways'],
		])('should refuse %s', async (_why, query) => {
			// GIVEN a word the app does not have
			// WHEN the request is made
			const response = await get(`/v1/email/messages?${query}`)
			// THEN it is turned away, rather than matching nothing for ever
			expect(response.status).toBe(400)
		})
	})
})
