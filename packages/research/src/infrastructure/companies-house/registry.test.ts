import { Cause, ConfigProvider, Effect, Exit, Fiber, Option } from 'effect'
import { TestClock } from 'effect/testing'
import {
	HttpClient,
	type HttpClientError,
	type HttpClientRequest,
	type HttpClientResponse,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../../domain/errors'
import type { RegistryRecord } from '../../domain/types'
import { makeCompaniesHouseRegistry } from './registry'

// ── Test helpers (mirrors librebor/registry.test.ts) ──

const jsonResponse = (
	request: HttpClientRequest.HttpClientRequest,
	status: number,
	body: unknown,
): HttpClientResponse.HttpClientResponse =>
	HttpClientResponseNs.fromWeb(
		request,
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		}),
	)

interface CallLog {
	count: number
	last: HttpClientRequest.HttpClientRequest | undefined
}

const routingClient = (
	log: CallLog,
	route: (url: string) => { status: number; body: unknown },
): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, request => {
				log.count += 1
				log.last = request
				const { status, body } = route(request.url)
				return Effect.succeed(jsonResponse(request, status, body))
			}),
		Effect.succeed,
	)

const runWithVirtualClock = async <A, E>(
	build: () => Effect.Effect<A, E, never>,
	budgetMs = 60_000,
	stepMs = 100,
): Promise<Exit.Exit<A, E>> => {
	const program = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(build())
		for (let elapsed = 0; elapsed < budgetMs; elapsed += stepMs) {
			if (fiber.pollUnsafe() !== undefined) break
			yield* Effect.yieldNow
			yield* TestClock.adjust(`${stepMs} millis`)
		}
		return yield* Fiber.await(fiber)
	})
	return Effect.runPromise(
		Effect.scoped(program).pipe(Effect.provide(TestClock.layer())),
	)
}

const errorOf = (
	exit: Exit.Exit<unknown, unknown>,
): ProviderError | undefined => {
	if (!Exit.isFailure(exit)) return undefined
	const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause))
	return err instanceof ProviderError ? err : undefined
}

const recordOf = (exit: Exit.Exit<RegistryRecord, unknown>) =>
	Exit.isSuccess(exit) ? exit.value : undefined

const profileBody = (overrides: Record<string, unknown> = {}) => ({
	company_name: 'ACME WIDGETS LTD',
	company_number: '12345678',
	company_status: 'active',
	date_of_creation: '2014-06-02',
	registered_office_address: {
		address_line_1: '20 Office Row',
		locality: 'London',
		postal_code: 'EC1A 1BB',
		country: 'England',
	},
	sic_codes: ['62012'],
	...overrides,
})

// One sitting director and one resigned officer — the resigned one must be dropped.
const officersBody = () => ({
	items: [
		{
			name: 'SMITH, Jane',
			officer_role: 'director',
			appointed_on: '2014-06-02',
		},
		{
			name: 'OLD, Bob',
			officer_role: 'director',
			appointed_on: '2010-01-01',
			resigned_on: '2016-01-01',
		},
	],
})

const routeOk = (url: string) =>
	url.includes('/search/companies')
		? {
				status: 200,
				body: { items: [{ company_number: '12345678', title: 'ACME' }] },
			}
		: url.includes('/officers')
			? { status: 200, body: officersBody() }
			: { status: 200, body: profileBody() }

const runLookup = (
	input: { country: 'GB'; query?: string; taxId?: string },
	route: (url: string) => { status: number; body: unknown },
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = routingClient(log, route)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const registry = yield* makeCompaniesHouseRegistry(0)
			return yield* registry.lookup(input)
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: { RESEARCH_API_KEY_REGISTRY_GB: 'chkey' },
					}),
				),
			),
		),
	)
	return { exit, log }
}

describe('makeCompaniesHouseRegistry', () => {
	describe('when resolving a company by its number', () => {
		it('should map the profile + active officers to a RegistryRecord', async () => {
			// GIVEN a company-number lookup with a profile and two officers
			const { exit, log } = runLookup(
				{ country: 'GB', taxId: '12345678' },
				routeOk,
			)

			// THEN identity, status, address, sector are mapped, and only the
			// sitting officer survives (the resigned one is dropped)
			const rec = recordOf(await exit)
			expect(rec?.legalName).toBe('ACME WIDGETS LTD')
			expect(rec?.taxId).toBe('12345678')
			expect(rec?.status).toBe('active')
			expect(rec?.incorporationDate).toBe('2014-06-02')
			expect(rec?.address).toContain('London')
			expect(rec?.sector).toBe('62012')
			expect(rec?.directors).toHaveLength(1)
			expect(rec?.directors?.[0]).toEqual({
				name: 'SMITH, Jane',
				role: 'director',
				since: '2014-06-02',
			})
			// AND it fetched profile + officers (no search)
			expect(log.count).toBe(2)
		})

		it('should authenticate with the key as the Basic username', async () => {
			// GIVEN any successful lookup with key "chkey"
			const { exit, log } = runLookup(
				{ country: 'GB', taxId: '12345678' },
				routeOk,
			)
			await exit
			// THEN auth is base64("chkey:") — the key as username, blank password
			const expected = `Basic ${Buffer.from('chkey:').toString('base64')}`
			expect(log.last?.headers['authorization']).toBe(expected)
		})
	})

	describe('when resolving a company by name', () => {
		it('should search first, then fetch the top hit profile + officers', async () => {
			// GIVEN a name query
			const { exit, log } = runLookup({ country: 'GB', query: 'Acme' }, routeOk)
			// THEN three calls (search → profile → officers) and a mapped record
			const rec = recordOf(await exit)
			expect(rec?.legalName).toBe('ACME WIDGETS LTD')
			expect(log.count).toBe(3)
			expect(log.last?.url).toContain('/officers')
		})

		it('should fail non-recoverably when the name matches nothing', async () => {
			// GIVEN an empty search result
			const { exit, log } = runLookup({ country: 'GB', query: 'Nope' }, url =>
				url.includes('/search/companies')
					? { status: 200, body: { items: [] } }
					: { status: 200, body: profileBody() },
			)
			// THEN it stops after the search, non-recoverably
			expect(errorOf(await exit)?.recoverable).toBe(false)
			expect(log.count).toBe(1)
		})
	})

	describe('when the request is unusable or rejected', () => {
		it('should fail non-recoverably with neither taxId nor query', async () => {
			// GIVEN no selector
			const { exit, log } = runLookup({ country: 'GB' }, routeOk)
			// THEN it fails before any HTTP call
			expect(errorOf(await exit)?.recoverable).toBe(false)
			expect(log.count).toBe(0)
		})

		it('should treat 401 as non-recoverable', async () => {
			// GIVEN a rejected key
			const { exit } = runLookup({ country: 'GB', taxId: '12345678' }, () => ({
				status: 401,
				body: { error: 'invalid-authorization-header' },
			}))
			expect(errorOf(await exit)?.recoverable).toBe(false)
		})

		it('should retry a 503 as recoverable', async () => {
			// GIVEN the API is overloaded on every attempt
			const { exit, log } = runLookup(
				{ country: 'GB', taxId: '12345678' },
				() => ({ status: 503, body: {} }),
			)
			// THEN it retries to the max and surfaces a recoverable error
			const resolved = await exit
			expect(log.count).toBe(3)
			expect(errorOf(resolved)?.recoverable).toBe(true)
		})
	})
})
