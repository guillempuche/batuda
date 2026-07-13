import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { ProviderError } from '../domain/errors'
import { withFallbackUntil } from './_fallback'

type Behavior = 'hit' | 'empty' | 'error'
interface Vendor {
	readonly label: string
	readonly behavior: Behavior
}
interface Result {
	readonly items: ReadonlyArray<number>
}

// Records the order vendors are tried, so a test can assert a later slot is only
// reached when the earlier ones came back empty or errored.
const invokeWithLog =
	(tried: string[]) =>
	(vendor: Vendor): Effect.Effect<Result, ProviderError> => {
		tried.push(vendor.label)
		if (vendor.behavior === 'error') {
			return Effect.fail(
				new ProviderError({
					provider: vendor.label,
					message: 'boom',
					recoverable: true,
				}),
			)
		}
		return Effect.succeed({ items: vendor.behavior === 'hit' ? [1] : [] })
	}

const run = (vendors: ReadonlyArray<Vendor>) => {
	const tried: string[] = []
	const exit = Effect.runPromiseExit(
		withFallbackUntil(
			vendors,
			invokeWithLog(tried),
			r => r.items.length === 0,
		)(undefined),
	)
	return { exit, tried }
}

describe('withFallbackUntil', () => {
	describe('when the first vendor has hits', () => {
		it('should return them without trying the next', async () => {
			// GIVEN a first vendor that returns results
			const { exit, tried } = run([
				{ label: 'firecrawl', behavior: 'hit' },
				{ label: 'brave-context', behavior: 'hit' },
			])

			// THEN only the first is tried
			const resolved = await exit
			expect(Exit.isSuccess(resolved) && resolved.value.items).toEqual([1])
			expect(tried).toEqual(['firecrawl'])
		})
	})

	describe('when the first vendor is empty', () => {
		it('should cascade to the next vendor and return its hits', async () => {
			// GIVEN a first vendor that finds nothing, a second that does
			const { exit, tried } = run([
				{ label: 'firecrawl', behavior: 'empty' },
				{ label: 'brave-context', behavior: 'hit' },
			])

			// THEN the empty result fell through to the richer vendor
			const resolved = await exit
			expect(Exit.isSuccess(resolved) && resolved.value.items).toEqual([1])
			expect(tried).toEqual(['firecrawl', 'brave-context'])
		})
	})

	describe('when the first vendor errors', () => {
		it('should cascade to the next vendor', async () => {
			// GIVEN a first vendor that errors
			const { exit, tried } = run([
				{ label: 'firecrawl', behavior: 'error' },
				{ label: 'brave-context', behavior: 'hit' },
			])

			// THEN it falls through
			const resolved = await exit
			expect(Exit.isSuccess(resolved) && resolved.value.items).toEqual([1])
			expect(tried).toEqual(['firecrawl', 'brave-context'])
		})
	})

	describe('when every vendor is empty', () => {
		it('should return a clean empty result, not an error', async () => {
			// GIVEN both vendors find nothing
			const { exit } = run([
				{ label: 'firecrawl', behavior: 'empty' },
				{ label: 'brave-context', behavior: 'empty' },
			])

			// THEN the caller gets an honest zero-hit
			const resolved = await exit
			expect(Exit.isSuccess(resolved) && resolved.value.items).toEqual([])
		})
	})

	describe('when every vendor errors', () => {
		it('should fail with the last error', async () => {
			// GIVEN both vendors error
			const { exit } = run([
				{ label: 'firecrawl', behavior: 'error' },
				{ label: 'brave-context', behavior: 'error' },
			])

			// THEN it fails (no vendor produced even an empty result)
			const resolved = await exit
			expect(Exit.isFailure(resolved)).toBe(true)
		})
	})
})
