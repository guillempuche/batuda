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
import { makeLibreborRegistry } from './registry'

// ── Test helpers ──

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

// Routes each request to a canned {status, body} by URL, so the
// search → by-slug two-hop flow can return different payloads per leg.
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

// The harden wrapper's retry backoff schedules real-time delays, so a test
// would hang forever on a wall clock. Run the lookup on its own fiber and keep
// nudging the virtual clock forward until it settles, which lets each backoff
// delay elapse instantly. `budgetMs` caps total virtual time; `stepMs` is how
// far each nudge jumps.
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

const companyBody = (overrides: Record<string, unknown> = {}) => ({
	company: {
		name: 'MERCADONA SA',
		nif: 'A46103834',
		status: 'active',
		capital: 15_920_000,
		date_creation: '1977-01-01',
		active_positions: [
			{
				name_person: 'ROIG ALFONSO JUAN',
				role: 'Presidente',
				date_from: '1981-01-01',
			},
		],
		...overrides,
	},
})

const runLookup = (
	input: { country: 'ES'; query?: string; taxId?: string },
	route: (url: string) => { status: number; body: unknown },
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = routingClient(log, route)
	const exit = runWithVirtualClock(() =>
		Effect.gen(function* () {
			const registry = yield* makeLibreborRegistry(0)
			return yield* registry.lookup(input)
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: { RESEARCH_API_KEY_REGISTRY_ES: 'id:key' },
					}),
				),
			),
		),
	)
	return { exit, log }
}

const recordOf = (exit: Exit.Exit<RegistryRecord, unknown>) =>
	Exit.isSuccess(exit) ? exit.value : undefined

describe('makeLibreborRegistry', () => {
	it('should map a by-NIF hit to a RegistryRecord', async () => {
		// GIVEN a NIF lookup that the registry resolves
		const { exit, log } = runLookup(
			{ country: 'ES', taxId: 'A46103834' },
			() => ({
				status: 200,
				body: companyBody(),
			}),
		)

		// THEN the record carries identity, status, capital, incorporation and directors
		const rec = recordOf(await exit)
		expect(rec?.legalName).toBe('MERCADONA SA')
		expect(rec?.taxId).toBe('A46103834')
		expect(rec?.status).toBe('active')
		expect(rec?.capital).toBe('15920000')
		expect(rec?.incorporationDate).toBe('1977-01-01')
		expect(rec?.directors?.[0]).toEqual({
			name: 'ROIG ALFONSO JUAN',
			role: 'Presidente',
			since: '1981-01-01',
		})
		expect(rec?.units).toBe(1)
		expect(log.count).toBe(1)
	})

	it('should send HTTP Basic auth from the AccessId:AccessKey pair', async () => {
		// GIVEN any successful lookup with the credential pair "id:key"
		const { exit, log } = runLookup(
			{ country: 'ES', taxId: 'A46103834' },
			() => ({
				status: 200,
				body: companyBody(),
			}),
		)
		await exit

		// THEN the request carries base64("id:key") as Basic auth, to the by-nif path
		const expected = `Basic ${Buffer.from('id:key').toString('base64')}`
		expect(log.last?.headers['authorization']).toBe(expected)
		expect(log.last?.url).toContain('/company/by-nif/A46103834/')
	})

	it('should resolve a name via search then fetch the top slug', async () => {
		// GIVEN a name query: first the search hit, then the company by slug
		const { exit, log } = runLookup(
			{ country: 'ES', query: 'Mercadona' },
			url =>
				url.includes('/company/search/')
					? { status: 200, body: { companies: [{ slug: 'mercadona' }] } }
					: { status: 200, body: companyBody() },
		)

		// THEN it makes two calls and returns the resolved company
		const rec = recordOf(await exit)
		expect(rec?.legalName).toBe('MERCADONA SA')
		expect(log.count).toBe(2)
		expect(log.last?.url).toContain('/company/by-slug/mercadona/')
	})

	it('should fail non-recoverably when a name matches nothing', async () => {
		// GIVEN a search that returns no companies
		const { exit, log } = runLookup(
			{ country: 'ES', query: 'Nonexistent' },
			() => ({
				status: 200,
				body: { companies: [] },
			}),
		)

		// THEN it fails fast without a second call
		const resolved = await exit
		expect(errorOf(resolved)?.recoverable).toBe(false)
		expect(log.count).toBe(1)
	})

	it('should fail non-recoverably with neither taxId nor query', async () => {
		// GIVEN an input missing both selectors
		const { exit, log } = runLookup({ country: 'ES' }, () => ({
			status: 200,
			body: companyBody(),
		}))

		// THEN it fails before any HTTP call
		const resolved = await exit
		expect(errorOf(resolved)?.recoverable).toBe(false)
		expect(log.count).toBe(0)
	})

	it('should treat 401 (bad credential) as non-recoverable', async () => {
		// GIVEN the API rejects the credential
		const { exit, log } = runLookup(
			{ country: 'ES', taxId: 'A46103834' },
			() => ({
				status: 401,
				body: { error: { code: 'UNAUTHORIZED' } },
			}),
		)

		// THEN it fails fast, no retry
		const resolved = await exit
		expect(errorOf(resolved)?.recoverable).toBe(false)
		expect(log.count).toBe(1)
	})

	it('should treat 404 (company not found) as non-recoverable', async () => {
		// GIVEN the company is not in the registry
		const { exit } = runLookup({ country: 'ES', taxId: 'A00000000' }, () => ({
			status: 404,
			body: { error: { code: 'NOT_FOUND' } },
		}))

		// THEN it fails non-recoverably
		expect(errorOf(await exit)?.recoverable).toBe(false)
	})

	it('should retry a 503 as recoverable', async () => {
		// GIVEN the registry is overloaded on every attempt
		const { exit, log } = runLookup(
			{ country: 'ES', taxId: 'A46103834' },
			() => ({
				status: 503,
				body: { error: { code: 'BACKEND_FAILED' } },
			}),
		)

		// THEN it retries to the max and surfaces a recoverable error
		const resolved = await exit
		expect(log.count).toBe(3)
		expect(errorOf(resolved)?.recoverable).toBe(true)
	})

	it('should fail non-recoverably on a malformed body', async () => {
		// GIVEN a 2xx response missing the `company` envelope
		const { exit } = runLookup({ country: 'ES', taxId: 'A46103834' }, () => ({
			status: 200,
			body: { wrong: 'shape' },
		}))

		// THEN the decode error is non-recoverable
		expect(errorOf(await exit)?.recoverable).toBe(false)
	})
})
