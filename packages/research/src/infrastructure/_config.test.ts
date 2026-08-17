import { ConfigProvider, Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { cacheBypassConfig } from './_config'

const read = (env: Record<string, string>) =>
	Effect.runPromise(
		cacheBypassConfig.pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
		),
	)

describe('going past the caches', () => {
	describe('when nobody asks for it', () => {
		it('should stay off', async () => {
			// GIVEN an environment that says nothing about it, which is every
			// environment but a measuring run asking for repeats
			const bypass = await read({})

			// WHEN read — THEN the caches are used. This is the setting that decides
			// whether the live system pays a provider for an answer it already has,
			// so silence has to mean "use them" and nothing else can be the default.
			expect(bypass).toBe(false)
		})
	})

	describe('when a measuring run asks for it', () => {
		it('should read the setting it was given', async () => {
			// GIVEN a pass repeating each company, which sets it for its own process
			const bypass = await read({ RESEARCH_CACHE_BYPASS: 'true' })

			// WHEN read — THEN every round asks the providers again, so the repeats
			// are separate readings rather than the first answer handed back
			expect(bypass).toBe(true)
		})
	})
})
