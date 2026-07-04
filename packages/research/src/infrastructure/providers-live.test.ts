import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { RegistryRouter } from '../application/ports'
import { NoRegistry, ProviderError } from '../domain/errors'
import { registryLayer } from './providers-live'

// registryLayer's type carries an HttpClient requirement (the libreBORME /
// Companies House builders need one). A stub-vendor boot never calls it, so a
// real fetch client satisfies the type without any network traffic.
const bootRegistry = (env: Record<string, string>) =>
	registryLayer.pipe(
		Layer.provide(FetchHttpClient.layer),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
	)

const lookup = (env: Record<string, string>, country: string) =>
	Effect.runPromiseExit(
		Effect.gen(function* () {
			const registry = yield* RegistryRouter
			return yield* registry.lookup({ country })
		}).pipe(Effect.provide(bootRegistry(env))),
	)

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
	Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined

const BOTH_STUBBED = {
	RESEARCH_PROVIDER_REGISTRY_ES: 'stub',
	RESEARCH_PROVIDER_REGISTRY_GB: 'stub',
}

describe('registryLayer routing', () => {
	describe('when the country has a national registry', () => {
		it('should dispatch ES to its adapter and return the record', async () => {
			// GIVEN ES and GB registries both configured
			// WHEN a Spanish company is looked up
			const exit = await lookup(BOTH_STUBBED, 'ES')
			// THEN the Spanish adapter's record comes back
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value.legalName).toBe('ACME CORP S.L.')
			}
		})

		it('should dispatch GB to its adapter — ES and GB are symmetric', async () => {
			// GIVEN the same both-configured layer
			// WHEN a UK company is looked up
			const exit = await lookup(BOTH_STUBBED, 'GB')
			// THEN the UK adapter's record comes back
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) {
				expect(exit.value.legalName).toBe('ACME WIDGETS LTD')
			}
		})
	})

	describe('when the country has no national registry', () => {
		it('should resolve to NoRegistry naming the country, not a hard failure', async () => {
			// GIVEN a registry-less country (the US files state-by-state)
			// WHEN it is looked up
			const failure = failureOf(await lookup(BOTH_STUBBED, 'US'))
			// THEN the outcome is an explicit NoRegistry carrying the country
			expect(failure).toBeInstanceOf(NoRegistry)
			if (failure instanceof NoRegistry) {
				expect(failure.country).toBe('US')
			}
		})
	})

	describe('when a registry country variable is unset', () => {
		it('should still boot and treat that country as disabled', async () => {
			// GIVEN only ES is configured — GB's variable is absent
			// WHEN a GB lookup runs (which forces the layer to have booted)
			const failure = failureOf(
				await lookup({ RESEARCH_PROVIDER_REGISTRY_ES: 'stub' }, 'GB'),
			)
			// THEN the layer built with no ConfigError and GB defaulted to disabled,
			// so the variable is no longer boot-mandatory
			expect(failure).toBeInstanceOf(ProviderError)
		})
	})
})
