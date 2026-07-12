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
import {
	fullEnrichStatusToVerdict,
	makeFullEnrichEnrichment,
} from './enrichment'

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

const countingClient = (
	log: CallLog,
	status: number,
	body: unknown,
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
				return Effect.succeed(jsonResponse(request, status, body))
			}),
		Effect.succeed,
	)

// hardenHttp retries recoverable failures with a jittered backoff, so drive the
// retries on a virtual clock — otherwise a 429/503 test would wall-clock wait.
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

const runFindPeople = async (
	status: number,
	body: unknown,
	domain = 'acme.example',
) => {
	const log: CallLog = { count: 0, last: undefined }
	const client = countingClient(log, status, body)
	const exit = await runWithVirtualClock(() =>
		Effect.gen(function* () {
			const provider = yield* makeFullEnrichEnrichment(0)
			return yield* provider.findPeople({ domain })
		}).pipe(
			Effect.provideService(HttpClient.HttpClient, client),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromEnv({
						env: { RESEARCH_API_KEY_ENRICH: 'fe_k' },
					}),
				),
			),
		),
	)
	return { exit, log }
}

describe('makeFullEnrichEnrichment', () => {
	describe('when the search returns people', () => {
		it('should map names, role, seniority, and linkedin — leaving the email to the pipeline', async () => {
			// GIVEN a decision-maker as People Search returns it: names + nested
			// employment + social profile, but no contact info (the common case)
			const { exit } = await runFindPeople(200, {
				people: [
					{
						first_name: 'Ada',
						last_name: 'Lovelace',
						employment: {
							current: {
								title: 'Chief Technology Officer',
								seniority: 'C-level',
							},
						},
						social_profiles: {
							professional_network: {
								url: 'https://www.linkedin.com/in/ada',
							},
						},
					},
				],
			})

			// THEN the person's fields land where the pipeline reads them; the email
			// is left unset so guess + verify resolves it
			const person = Exit.isSuccess(exit) ? exit.value.people[0] : undefined
			expect(person?.firstName).toBe('Ada')
			expect(person?.lastName).toBe('Lovelace')
			expect(person?.position).toBe('Chief Technology Officer')
			expect(person?.seniority).toBe('C-level')
			expect(person?.linkedin).toBe('https://www.linkedin.com/in/ada')
			expect(person?.email).toBeUndefined()
			expect(person?.verification).toBeUndefined()
		})

		it('should read an email + deliverability status when the plan returns contact info', async () => {
			// GIVEN a paid-plan person with a most-probable work email + status
			const { exit } = await runFindPeople(200, {
				people: [
					{
						first_name: 'Bo',
						last_name: 'Jones',
						employment: { current: { title: 'VP Sales', seniority: 'VP' } },
						most_probable_work_email: {
							email: 'bo@acme.example',
							status: 'DELIVERABLE',
						},
					},
				],
			})

			// THEN the email + its verdict come through so the pipeline can skip a guess
			const person = Exit.isSuccess(exit) ? exit.value.people[0] : undefined
			expect(person?.email).toBe('bo@acme.example')
			expect(person?.verification).toBe('deliverable')
		})

		it('should treat a hidden last name as empty so it never leaks into a guess', async () => {
			// GIVEN FullEnrich's free-plan sentinel for a redacted surname
			const { exit } = await runFindPeople(200, {
				people: [
					{
						first_name: 'Dana',
						last_name: 'HIDDEN_ON_FREE_PLAN',
						employment: {
							current: { title: 'Head of Ops', seniority: 'Head' },
						},
					},
				],
			})

			// THEN the surname is dropped rather than used as a real name
			const person = Exit.isSuccess(exit) ? exit.value.people[0] : undefined
			expect(person?.firstName).toBe('Dana')
			expect(person?.lastName).toBe('')
		})
	})

	describe('when the search matches nobody', () => {
		it('should return no people rather than an error, and not retry', async () => {
			// GIVEN a 200 with an empty people array
			const { exit, log } = await runFindPeople(200, { people: [] })

			// THEN an empty result (an empty search is a success, not a failure)
			const result = Exit.isSuccess(exit) ? exit.value : undefined
			expect(result?.people).toEqual([])
			expect(log.count).toBe(1)
		})
	})

	describe('when the API rejects the request', () => {
		it('should fail non-recoverably on a 401 so the waterfall moves on', async () => {
			// GIVEN an auth rejection
			const { exit, log } = await runFindPeople(401, { code: 'unauthorized' })

			// THEN it fails once, without retrying, and is not recoverable
			expect(log.count).toBe(1)
			expect(errorOf(exit)?.recoverable).toBe(false)
		})
	})

	describe('when the API is transiently unavailable', () => {
		it('should treat 429 as recoverable and retry to the max', async () => {
			// GIVEN a rate-limit on every attempt
			const { exit, log } = await runFindPeople(429, { code: 'rate_limited' })

			// THEN it retries to the cap and surfaces a recoverable error
			expect(log.count).toBe(3)
			expect(errorOf(exit)?.recoverable).toBe(true)
		})

		it('should treat a 503 as recoverable', async () => {
			// GIVEN a server error on every attempt
			const { exit, log } = await runFindPeople(503, { code: 'unavailable' })

			// THEN it retries to the cap with a recoverable error
			expect(log.count).toBe(3)
			expect(errorOf(exit)?.recoverable).toBe(true)
		})
	})
})

describe('fullEnrichStatusToVerdict', () => {
	describe('when a deliverability status is present', () => {
		it('should map each FullEnrich status onto the pipeline verdict', () => {
			// GIVEN the statuses FullEnrich returns (case-insensitively)
			// THEN each maps to the matching verdict
			expect(fullEnrichStatusToVerdict('DELIVERABLE')).toBe('deliverable')
			expect(fullEnrichStatusToVerdict('undeliverable')).toBe('undeliverable')
			expect(fullEnrichStatusToVerdict('INVALID')).toBe('undeliverable')
			expect(fullEnrichStatusToVerdict('Risky')).toBe('risky')
			expect(fullEnrichStatusToVerdict('CATCH_ALL')).toBe('catch_all')
			expect(fullEnrichStatusToVerdict('UNKNOWN')).toBe('unknown')
		})
	})

	describe('when there is no usable status', () => {
		it('should return undefined so the pipeline verifies the address itself', () => {
			// GIVEN a missing or unrecognised status
			// THEN there is no verdict to assert
			expect(fullEnrichStatusToVerdict(undefined)).toBeUndefined()
			expect(fullEnrichStatusToVerdict(null)).toBeUndefined()
			expect(fullEnrichStatusToVerdict('something-else')).toBeUndefined()
		})
	})
})
