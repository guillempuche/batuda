import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handOverFromServer, isNotFoundError } from './atom-hydration'

// The API client is reached through a dynamic import behind the server-only
// branch; here it is replaced so the program under test runs against nothing.
vi.mock('./batuda-api-server', () => ({
	withServerApi: (program: (client: unknown) => Effect.Effect<unknown>) =>
		Effect.runPromise(program({})),
}))

const empty = { dehydrated: [] }

describe('handOverFromServer', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	describe('when the page is rendered in the browser', () => {
		it('should hand nothing over and never fetch', async () => {
			// GIVEN a browser render
			vi.stubEnv('SSR', false)
			const fetch = vi.fn(() => Effect.succeed(1))

			// WHEN the loader runs
			const result = await handOverFromServer({
				label: 'Test',
				empty: { dehydrated: [], count: 0 },
				fetch,
				handOver: () => ({ dehydrated: [], count: 1 }),
			})

			// THEN the empty result comes back and the API was not asked
			expect(result).toEqual({ dehydrated: [], count: 0 })
			expect(fetch).not.toHaveBeenCalled()
		})
	})

	describe('when the page is rendered on the server', () => {
		it('should hand over what the fetch returned', async () => {
			// GIVEN a server render and a program that answers
			vi.stubEnv('SSR', true)

			// WHEN the loader runs
			const result = await handOverFromServer({
				label: 'Test',
				empty: { dehydrated: [], count: 0 },
				fetch: () => Effect.succeed(41),
				handOver: value => ({ dehydrated: [], count: value + 1 }),
			})

			// THEN the handover saw the fetched value
			expect(result).toEqual({ dehydrated: [], count: 42 })
		})

		it('should log and degrade to empty when the fetch fails', async () => {
			// GIVEN a server render and a program that fails
			vi.stubEnv('SSR', true)
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

			// WHEN the loader runs
			const result = await handOverFromServer({
				label: 'TestLoader',
				empty,
				fetch: () => Effect.fail(new Error('down')),
				handOver: () => ({ dehydrated: [] }),
			})

			// THEN the page still gets a result, and the failure is on record
			expect(result).toBe(empty)
			expect(warn).toHaveBeenCalledWith(
				'[TestLoader] falling back to empty hydration:',
				expect.anything(),
			)
		})

		it('should give up with a not-found page when told the record is missing', async () => {
			// GIVEN a server render and a failure the route treats as "not found"
			vi.stubEnv('SSR', true)
			vi.spyOn(console, 'warn').mockImplementation(() => {})

			// WHEN the loader runs
			const attempt = handOverFromServer({
				label: 'Test',
				empty,
				fetch: () => Effect.fail({ _tag: 'NotFound' }),
				handOver: () => ({ dehydrated: [] }),
				notFoundWhen: isNotFoundError,
			})

			// THEN it throws the router's not-found rather than degrading
			await expect(attempt).rejects.toMatchObject({ isNotFound: true })
		})

		it('should not catch a handover that throws', async () => {
			// GIVEN a server render and a handover with a programming mistake
			vi.stubEnv('SSR', true)
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

			// WHEN the loader runs
			const attempt = handOverFromServer({
				label: 'Test',
				empty,
				fetch: () => Effect.succeed(1),
				handOver: (): typeof empty => {
					throw new Error('atom is not serializable')
				},
			})

			// THEN the mistake breaks the page instead of turning into a refetch
			await expect(attempt).rejects.toThrow('atom is not serializable')
			expect(warn).not.toHaveBeenCalled()
		})
	})
})

describe('isNotFoundError', () => {
	it('should recognise the API failure tagged NotFound and nothing else', () => {
		// GIVEN the tagged failure, another failure, and non-objects
		// THEN only the tagged one counts
		expect(isNotFoundError({ _tag: 'NotFound' })).toBe(true)
		expect(isNotFoundError({ _tag: 'Forbidden' })).toBe(false)
		expect(isNotFoundError(new Error('NotFound'))).toBe(false)
		expect(isNotFoundError(null)).toBe(false)
		expect(isNotFoundError('NotFound')).toBe(false)
	})
})
