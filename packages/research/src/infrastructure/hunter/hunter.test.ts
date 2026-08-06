import { ConfigProvider, Effect } from 'effect'
import {
	HttpClient,
	type HttpClientError,
	type HttpClientRequest,
	type HttpClientResponse,
	HttpClientResponse as HttpClientResponseNs,
} from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { hunterStatusToVerdict } from './_client'
import { makeHunterEnrichment } from './enrichment'
import { toVerdict } from './verifier'

const API_KEY = 'secret-hunter-key'

interface CapturedCall {
	request: HttpClientRequest.HttpClientRequest | undefined
}

// Captures the one request the provider makes, answering with an empty but
// well-formed Domain Search body so decoding succeeds.
const capturingClient = (captured: CapturedCall): HttpClient.HttpClient =>
	HttpClient.makeWith<
		HttpClientError.HttpClientError,
		never,
		HttpClientError.HttpClientError,
		never
	>(
		effect =>
			Effect.flatMap(effect, request => {
				captured.request = request
				const response: HttpClientResponse.HttpClientResponse =
					HttpClientResponseNs.fromWeb(
						request,
						new Response(JSON.stringify({ data: { emails: [] } }), {
							status: 200,
							headers: { 'content-type': 'application/json' },
						}),
					)
				return Effect.succeed(response)
			}),
		Effect.succeed,
	)

const runDomainSearch = (captured: CapturedCall) =>
	Effect.gen(function* () {
		const provider = yield* makeHunterEnrichment(0)
		yield* provider.findPeople({ domain: 'example.com' })
	}).pipe(
		Effect.provideService(HttpClient.HttpClient, capturingClient(captured)),
		Effect.provide(
			ConfigProvider.layer(
				ConfigProvider.fromEnv({
					env: { RESEARCH_API_KEY_ENRICH: API_KEY },
				}),
			),
		),
		Effect.runPromise,
	)

describe('hunterStatusToVerdict', () => {
	describe('when Domain Search carries a definitive status', () => {
		it('should map valid/invalid/accept_all to pipeline verdicts', () => {
			// GIVEN Hunter per-email statuses
			// THEN they fold onto the shared verdict set
			expect(hunterStatusToVerdict('valid')).toBe('deliverable')
			expect(hunterStatusToVerdict('invalid')).toBe('undeliverable')
			expect(hunterStatusToVerdict('accept_all')).toBe('catch_all')
		})
	})

	describe('when Hunter has no usable status', () => {
		it('should return undefined so the caller falls through to verification', () => {
			// GIVEN a missing status
			// THEN there is no verdict to reuse
			expect(hunterStatusToVerdict(null)).toBeUndefined()
			expect(hunterStatusToVerdict(undefined)).toBeUndefined()
		})

		it('should treat webmail/disposable as unknown', () => {
			// GIVEN inconclusive statuses
			// THEN they degrade to unknown (still a verdict, ranked low)
			expect(hunterStatusToVerdict('webmail')).toBe('unknown')
			expect(hunterStatusToVerdict('disposable')).toBe('unknown')
		})
	})
})

describe('toVerdict', () => {
	describe('when the domain accepts all recipients', () => {
		it('should collapse any result to catch_all', () => {
			// GIVEN an accept-all domain
			// THEN even a "deliverable" result is unprovable → catch_all
			expect(toVerdict('deliverable', true)).toBe('catch_all')
		})
	})

	describe('when the domain is not accept-all', () => {
		it('should pass the Email Verifier result through', () => {
			// GIVEN concrete verifier results on a normal domain
			// THEN they map one-to-one
			expect(toVerdict('deliverable', false)).toBe('deliverable')
			expect(toVerdict('undeliverable', false)).toBe('undeliverable')
			expect(toVerdict('risky', false)).toBe('risky')
		})

		it('should map an unrecognised result to unknown', () => {
			// GIVEN a result outside the known set
			// THEN it is unknown, never silently deliverable
			expect(toVerdict('weird', false)).toBe('unknown')
		})
	})
})

describe('makeHunterEnrichment', () => {
	describe('when it authenticates a request', () => {
		it('should keep the key out of the URL the trace records', async () => {
			// GIVEN a configured Hunter key
			const captured: CapturedCall = { request: undefined }

			// WHEN the provider looks a domain up
			await runDomainSearch(captured)

			// THEN neither the key nor an `api_key` parameter is in the URL, which
			// goes on the trace verbatim
			expect(captured.request?.url).not.toContain(API_KEY)
			expect(captured.request?.url).not.toContain('api_key')
		})

		it('should send the key in a header the client redacts', async () => {
			// GIVEN a configured Hunter key
			const captured: CapturedCall = { request: undefined }

			// WHEN the provider looks a domain up
			await runDomainSearch(captured)

			// THEN it rides in `X-API-KEY`, one of the names blanked out on the trace
			expect(captured.request?.headers['x-api-key']).toBe(API_KEY)
		})
	})
})
