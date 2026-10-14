// Live-DB integration test for requests the server used to answer as a
// breakage, or as a success, when the honest answer is a refusal: listing
// calendar event types, logging a note against a company or contact that is not
// there, editing another organisation's records, and testing a webhook endpoint
// that is not there.
//
// Driven through the real routes and handlers on an in-process server, inside an
// org scope entered the way a signed-in request enters it, so row-level security
// applies exactly as in production. A 404 and a 500 spell the same to the
// compiler; only a real request can tell them apart.
//
// Prereq: `pnpm cli services up` — the integration runner's globalSetup builds,
// migrates and seeds the disposable database this suite runs against.

import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BookingProvider } from '@batuda/calendar'
import {
	CalendarGroup,
	CompaniesGroup,
	DocumentsGroup,
	InteractionsGroup,
	OrgMiddleware,
	PagesGroup,
	ProductsGroup,
	ProposalsGroup,
	SessionContext,
	SessionMiddleware,
	WebhooksGroup,
} from '@batuda/controllers'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from '../db/client'
import { EnvVars } from '../lib/env'
import { enterOrgScope } from '../middleware/org'
import { CalendarService } from '../services/calendar'
import { CompanyService } from '../services/companies'
import { EmailService } from '../services/email'
import { Geocoder } from '../services/geocoder'
import { PageService } from '../services/pages'
import { StorageProvider } from '../services/storage-provider'
import { WebhookService } from '../services/webhooks'
import { applyTestEnv } from '../test-env'
import { CalendarLive } from './calendar'
import { CompaniesLive } from './companies'
import { DocumentsLive } from './documents'
import { InteractionsLive } from './interactions'
import { PagesLive } from './pages'
import { ProductsLive } from './products'
import { ProposalsLive } from './proposals'
import { WebhooksLive } from './webhooks'

applyTestEnv()

const DATABASE_URL = process.env['DATABASE_URL'] as string

type Org = { readonly id: string; readonly name: string; readonly slug: string }

let pool: pg.Pool
let taller: Org
let restaurant: Org
// A company that belongs to the other organisation, put there for the test.
let theirCompanyId: string
// One of ours, to log notes against.
let ourCompanyId: string
// One of each editable record, in Taller and in the other organisation.
type Pair = { readonly ours: string; readonly theirs: string }
let proposals: Pair
let pages: Pair
let documents: Pair
let products: Pair
let webhooks: Pair
// Stands in for the outside world: every webhook here points at it, so no test
// event leaves the machine. It records the path each delivery arrived on.
let receiver: Server
const delivered: Array<string> = []
const TAG = `refusals-${randomUUID().slice(0, 8)}`
const actorId = `refusals-actor-${randomUUID()}`

// Only the groups these requests are about. The whole application would drag in
// every other area's dependencies. It keeps the application's own name, which is
// what lets the real handlers be mounted on it.
const Api = HttpApi.make('BatudaApi')
	.add(CalendarGroup)
	.add(CompaniesGroup)
	.add(InteractionsGroup)
	.add(ProposalsGroup)
	.add(PagesGroup)
	.add(DocumentsGroup)
	.add(ProductsGroup)
	.add(WebhooksGroup)

const signedIn = Layer.succeed(
	SessionMiddleware,
	<A, E, R>(request: Effect.Effect<A, E, R>) =>
		Effect.provideService(request, SessionContext, {
			userId: actorId,
			email: `${actorId}@test.local`,
			name: undefined,
			isAgent: false,
		}),
)

// Acting in Taller, entered through the same combinator the real middleware
// hands each request to.
const actingInTaller = Layer.effect(
	OrgMiddleware,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return effect =>
			enterOrgScope(sql, { org: taller, userId: actorId, role: 'owner' })(
				effect,
			)
	}),
)

const Db = PgLive.pipe(Layer.provide(EnvVars.layer))

const ServerLive = HttpRouter.serve(
	HttpApiBuilder.layer(Api).pipe(
		Layer.provide([
			CalendarLive,
			CompaniesLive,
			InteractionsLive,
			ProposalsLive,
			PagesLive,
			DocumentsLive,
			ProductsLive,
			WebhooksLive,
		]),
		Layer.provide([signedIn, actingInTaller]),
	),
	{ disableListenLog: true },
).pipe(
	Layer.provide([
		CompanyService.layer,
		TimelineActivityService.layer,
		PageService.layer,
		WebhookService.layer,
		// None of these is reached by the requests below: no edit here moves a
		// company, listing event types asks no calendar provider, no meeting or
		// mail is touched, and no document here keeps its body as a stored file.
		Layer.succeed(StorageProvider, {} as never),
		Layer.succeed(Geocoder, {} as never),
		Layer.succeed(BookingProvider, {} as never),
		Layer.succeed(CalendarService, {} as never),
		Layer.succeed(EmailService, {} as never),
	]),
	Layer.provideMerge(Db),
	Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
)

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

const orgBySlug = async (slug: string): Promise<Org> => {
	const rows = await pool.query<Org>(
		`SELECT id, name, slug FROM organization WHERE slug = $1`,
		[slug],
	)
	const org = rows.rows[0]
	if (!org) throw new Error(`${slug} org missing — run the integration setup`)
	return org
}

const insertCompany = async (orgId: string, name: string) => {
	const rows = await pool.query<{ id: string }>(
		`INSERT INTO companies (organization_id, slug, name, status)
		 VALUES ($1, $2, $2, 'prospect') RETURNING id`,
		[orgId, `${TAG}-${name}`],
	)
	const id = rows.rows[0]?.id
	if (!id) throw new Error('company insert returned no row')
	return id
}

const insertReturningId = async (text: string, values: Array<unknown>) => {
	const rows = await pool.query<{ id: string }>(text, values)
	const id = rows.rows[0]?.id
	if (!id) throw new Error(`insert returned no row: ${text}`)
	return id
}

const insertProposal = (orgId: string, companyId: string, name: string) =>
	insertReturningId(
		`INSERT INTO proposals (organization_id, company_id, title, line_items)
		 VALUES ($1, $2, $3, '[]'::jsonb) RETURNING id`,
		[orgId, companyId, `${TAG}-${name}`],
	)

const insertPage = (orgId: string, name: string) =>
	insertReturningId(
		`INSERT INTO pages (organization_id, slug, lang, title, content)
		 VALUES ($1, $2, 'en', $2, '{"type":"doc","content":[]}'::jsonb) RETURNING id`,
		[orgId, `${TAG}-${name}`],
	)

const insertDocument = (orgId: string, name: string) =>
	insertReturningId(
		`INSERT INTO documents (organization_id, type, title, content)
		 VALUES ($1, 'general', $2, 'Body') RETURNING id`,
		[orgId, `${TAG}-${name}`],
	)

const insertProduct = (orgId: string, name: string) =>
	insertReturningId(
		`INSERT INTO products (organization_id, slug, name, type)
		 VALUES ($1, $2, $2, 'service') RETURNING id`,
		[orgId, `${TAG}-${name}`],
	)

const insertWebhook = (orgId: string, name: string, receiverUrl: string) =>
	insertReturningId(
		`INSERT INTO webhook_endpoints (organization_id, name, url, events)
		 VALUES ($1, $2, $3, ARRAY['test']) RETURNING id`,
		[orgId, `${TAG}-${name}`, `${receiverUrl}/${name}`],
	)

// Deliveries run in the background after the answer, so wait for one to land.
const waitForDelivery = async (path: string) => {
	for (let tries = 0; tries < 50; tries++) {
		if (delivered.includes(path)) return
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error(`no delivery reached ${path}`)
}

const note = (overrides: Record<string, unknown>) => ({
	companyId: ourCompanyId,
	channel: 'email',
	direction: 'outbound',
	type: 'note',
	summary: TAG,
	...overrides,
})

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 })
	await pool.query('GRANT app_user TO CURRENT_USER')
	taller = await orgBySlug('taller')
	restaurant = await orgBySlug('restaurant')
	ourCompanyId = await insertCompany(taller.id, 'ours')
	theirCompanyId = await insertCompany(restaurant.id, 'theirs')

	receiver = createServer((req, res) => {
		delivered.push(req.url ?? '')
		req.resume()
		res.end()
	})
	await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve))
	const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`

	proposals = {
		ours: await insertProposal(taller.id, ourCompanyId, 'ours'),
		theirs: await insertProposal(restaurant.id, theirCompanyId, 'theirs'),
	}
	pages = {
		ours: await insertPage(taller.id, 'ours'),
		theirs: await insertPage(restaurant.id, 'theirs'),
	}
	documents = {
		ours: await insertDocument(taller.id, 'ours'),
		theirs: await insertDocument(restaurant.id, 'theirs'),
	}
	products = {
		ours: await insertProduct(taller.id, 'ours'),
		theirs: await insertProduct(restaurant.id, 'theirs'),
	}
	webhooks = {
		ours: await insertWebhook(taller.id, 'ours', receiverUrl),
		theirs: await insertWebhook(restaurant.id, 'theirs', receiverUrl),
	}
	// A second Taller endpoint listening for test events, which a test of the
	// first must leave alone.
	await insertWebhook(taller.id, 'bystander', receiverUrl)

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

afterAll(async () => {
	await runtime.dispose()
	await new Promise(resolve => receiver.close(resolve))
	await pool.query(`DELETE FROM pages WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.query(`DELETE FROM documents WHERE title LIKE $1`, [`${TAG}-%`])
	await pool.query(`DELETE FROM products WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.query(`DELETE FROM webhook_endpoints WHERE name LIKE $1`, [
		`${TAG}-%`,
	])
	await pool.query(
		`DELETE FROM timeline_activity WHERE company_id IN (
			SELECT id FROM companies WHERE slug LIKE $1
		)`,
		[`${TAG}-%`],
	)
	await pool.query(
		`DELETE FROM interactions WHERE company_id IN (
			SELECT id FROM companies WHERE slug LIKE $1
		)`,
		[`${TAG}-%`],
	)
	await pool.query(`DELETE FROM companies WHERE slug LIKE $1`, [`${TAG}-%`])
	await pool.end()
})

describe('listing calendar event types', () => {
	describe('when the organisation asks for its event types', () => {
		it('should answer with the list rather than a breakage', async () => {
			// GIVEN event types belong to the organisation, not to any company
			// WHEN they are listed, with and without the active filter
			const all = await request('GET', '/v1/calendar/event-types')
			const active = await request(
				'GET',
				'/v1/calendar/event-types?active=true',
			)

			// THEN both answer 200 with a list — asking whether a company is still
			// visible, on a table with no company column, failed every call
			expect(all.status).toBe(200)
			expect(Array.isArray(await all.json())).toBe(true)
			expect(active.status).toBe(200)
		})
	})
})

describe('logging a note', () => {
	describe('when the company named is not there', () => {
		it('should answer 404 naming the company, and write nothing', async () => {
			// GIVEN an id shaped like a company's that matches none here
			const missing = randomUUID()

			// WHEN a note is logged against it
			const response = await request(
				'POST',
				'/v1/interactions',
				note({ companyId: missing }),
			)

			// THEN the caller hears it is not there, rather than a 500 from the
			// database refusing the write
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({
				_tag: 'NotFound',
				entity: 'company',
				id: missing,
			})
		})
	})

	describe('when the company belongs to another organisation', () => {
		it('should answer 404 the same way', async () => {
			// GIVEN a company row-level security hides from Taller
			// WHEN a note is logged against it
			const response = await request(
				'POST',
				'/v1/interactions',
				note({ companyId: theirCompanyId }),
			)

			// THEN it reads as not there, telling nothing about the other org
			expect(response.status).toBe(404)
			const written = await pool.query(
				`SELECT 1 FROM interactions WHERE company_id = $1`,
				[theirCompanyId],
			)
			expect(written.rowCount).toBe(0)
		})
	})

	describe('when the contact named is not there', () => {
		it('should answer 404 naming the contact', async () => {
			// GIVEN a real company of ours and a contact id that matches nobody
			const missing = randomUUID()

			// WHEN a note is logged with that contact
			const response = await request(
				'POST',
				'/v1/interactions',
				note({ contactId: missing }),
			)

			// THEN the contact is the thing reported missing
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({
				_tag: 'NotFound',
				entity: 'contact',
				id: missing,
			})
		})
	})

	describe('when the follow-up date cannot be read', () => {
		it('should answer 400 before anything is written', async () => {
			// GIVEN a follow-up date no calendar can hold
			// WHEN a note is logged with it
			const response = await request(
				'POST',
				'/v1/interactions',
				note({ nextActionAt: 'next-ish' }),
			)

			// THEN it is refused as the caller's mistake
			expect(response.status).toBe(400)
		})

		it('should refuse loose text the engine would still read as a date', async () => {
			// GIVEN text a JavaScript date parser accepts but that is no ISO date
			for (const nextActionAt of ['1', 'March 7', '2026-13-45']) {
				// WHEN a note is logged with it
				const response = await request(
					'POST',
					'/v1/interactions',
					note({ nextActionAt }),
				)

				// THEN it is refused before it can reach the database
				expect(response.status).toBe(400)
			}
		})
	})

	describe('when everything named is there', () => {
		it('should log the note, with a follow-up date as the web form sends it', async () => {
			// GIVEN our own company and a plain calendar date
			// WHEN a note is logged
			const response = await request(
				'POST',
				'/v1/interactions',
				note({ nextAction: 'Call back', nextActionAt: '2026-11-02' }),
			)

			// THEN it is written and handed back
			expect(response.status).toBe(200)
			const body = (await response.json()) as { companyId: string }
			expect(body.companyId).toBe(ourCompanyId)
		})
	})
})

describe('editing a company', () => {
	describe('when the company belongs to another organisation', () => {
		it('should answer 404 and leave it untouched', async () => {
			// GIVEN a company row-level security hides from Taller
			// WHEN Taller tries to rename it
			const response = await request(
				'PATCH',
				`/v1/companies/${theirCompanyId}`,
				{ name: 'Taken over' },
			)

			// THEN the answer is not found — a 200 with an empty body read as an
			// edit that landed
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({
				_tag: 'NotFound',
				entity: 'company',
				id: theirCompanyId,
			})

			// AND the other organisation's company keeps its name
			const after = await pool.query<{ name: string }>(
				`SELECT name FROM companies WHERE id = $1`,
				[theirCompanyId],
			)
			expect(after.rows[0]?.name).toBe(`${TAG}-theirs`)
		})
	})

	describe('when the company is ours', () => {
		it('should apply the edit', async () => {
			// GIVEN a company in Taller
			// WHEN it is renamed
			const response = await request('PATCH', `/v1/companies/${ourCompanyId}`, {
				name: `${TAG}-ours-renamed`,
			})

			// THEN the edit lands and the company comes back
			expect(response.status).toBe(200)
			const body = (await response.json()) as { name: string }
			expect(body.name).toBe(`${TAG}-ours-renamed`)
		})
	})
})

// Each edit route, with the table its record lives in, the column the edit
// writes, and the value an untouched record keeps there.
const edits = [
	{
		entity: 'proposal',
		table: 'proposals',
		column: 'title',
		ids: () => proposals,
		request: (id: string) =>
			request('PATCH', `/v1/proposals/${id}`, { title: `${TAG}-edited` }),
		kept: () => `${TAG}-theirs`,
	},
	{
		entity: 'page',
		table: 'pages',
		column: 'title',
		ids: () => pages,
		request: (id: string) =>
			request('PATCH', `/v1/pages/${id}`, { title: `${TAG}-edited` }),
		kept: () => `${TAG}-theirs`,
	},
	{
		entity: 'page',
		table: 'pages',
		column: 'status',
		ids: () => pages,
		request: (id: string) => request('PATCH', `/v1/pages/${id}/publish`),
		kept: () => 'draft',
	},
	{
		entity: 'document',
		table: 'documents',
		column: 'title',
		ids: () => documents,
		request: (id: string) =>
			request('PATCH', `/v1/documents/${id}`, { title: `${TAG}-edited` }),
		kept: () => `${TAG}-theirs`,
	},
	{
		entity: 'product',
		table: 'products',
		column: 'name',
		ids: () => products,
		request: (id: string) =>
			request('PATCH', `/v1/products/${id}`, { name: `${TAG}-edited` }),
		kept: () => `${TAG}-theirs`,
	},
	{
		entity: 'webhook',
		table: 'webhook_endpoints',
		column: 'name',
		ids: () => webhooks,
		request: (id: string) =>
			request('PATCH', `/v1/webhooks/${id}`, { name: `${TAG}-edited` }),
		kept: () => `${TAG}-theirs`,
	},
] as const

describe.each(edits)('editing a $entity ($column)', edit => {
	describe('when it belongs to another organisation', () => {
		it('should answer 404 and leave it untouched', async () => {
			// GIVEN a record row-level security hides from Taller
			const { theirs } = edit.ids()

			// WHEN Taller edits it
			const response = await edit.request(theirs)

			// THEN the answer is not found, not a 200 with an empty body
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({
				_tag: 'NotFound',
				entity: edit.entity,
				id: theirs,
			})

			// AND the other organisation's record keeps its value
			const after = await pool.query<Record<string, unknown>>(
				`SELECT ${edit.column} AS value FROM ${edit.table} WHERE id = $1`,
				[theirs],
			)
			expect(after.rows[0]?.['value']).toBe(edit.kept())
		})
	})

	describe('when no record has that id', () => {
		it('should answer 404 naming the id', async () => {
			// GIVEN an id that matches nothing anywhere
			const missing = randomUUID()

			// WHEN it is edited
			const response = await edit.request(missing)

			// THEN the caller hears it is not there
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({
				_tag: 'NotFound',
				entity: edit.entity,
				id: missing,
			})
		})
	})

	describe('when it is ours', () => {
		it('should apply the edit and hand the record back', async () => {
			// GIVEN a record in Taller
			const { ours } = edit.ids()

			// WHEN it is edited
			const response = await edit.request(ours)

			// THEN the edit lands
			expect(response.status).toBe(200)
			const body = (await response.json()) as { id: string }
			expect(body.id).toBe(ours)
		})
	})
})

describe('testing a webhook endpoint', () => {
	describe('when no endpoint has that id', () => {
		it('should answer 404 and send nothing', async () => {
			// GIVEN an id that matches no endpoint
			const missing = randomUUID()
			const before = delivered.length

			// WHEN it is tested
			const response = await request('POST', `/v1/webhooks/${missing}/test`)

			// THEN the caller hears it is not there, rather than a 200 that sent a
			// test event to every endpoint listening for one
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({
				_tag: 'NotFound',
				entity: 'webhook',
				id: missing,
			})
			await new Promise(resolve => setTimeout(resolve, 300))
			expect(delivered.length).toBe(before)
		})
	})

	describe('when the endpoint belongs to another organisation', () => {
		it('should answer 404 and send nothing to it', async () => {
			// GIVEN an endpoint row-level security hides from Taller
			// WHEN Taller tests it
			const response = await request(
				'POST',
				`/v1/webhooks/${webhooks.theirs}/test`,
			)

			// THEN it reads as not there, and the other org's endpoint hears nothing
			expect(response.status).toBe(404)
			await new Promise(resolve => setTimeout(resolve, 300))
			expect(delivered).not.toContain('/theirs')
		})
	})

	describe('when the endpoint is ours', () => {
		it('should send the test event to that endpoint only', async () => {
			// GIVEN two Taller endpoints listening for test events
			delivered.length = 0

			// WHEN one of them is tested
			const response = await request(
				'POST',
				`/v1/webhooks/${webhooks.ours}/test`,
			)

			// THEN the answer is a success and the tested endpoint receives it
			expect(response.ok).toBe(true)
			await waitForDelivery('/ours')

			// AND the other endpoint, though listening, is left alone
			await new Promise(resolve => setTimeout(resolve, 300))
			expect(delivered).toEqual(['/ours'])
		})
	})
})
