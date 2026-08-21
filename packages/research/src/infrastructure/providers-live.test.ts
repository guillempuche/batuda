import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { describe, expect, it } from 'vitest'

import { EnrichmentChain, RegistryRouter } from '../application/ports'
import type { RegistryCountry } from '../domain/country'
import { NoRegistry, ProviderError } from '../domain/errors'
import {
	type CapabilityEndpoint,
	configuredCapabilityEndpoints,
	configuredRegistryEndpoints,
	enrichmentLayer,
	type RegistryEndpoint,
	type ResearchCapability,
	type ResolvedCapability,
	registryLayer,
	resolvedCapabilityVendors,
} from './providers-live'

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

// enrichmentLayer turns RESEARCH_PROVIDER_ENRICH / RESEARCH_ENRICH_MODE into the
// ordered chain the discovery waterfall runs. Reading .attempts only inspects
// each vendor's findPeople reference, so no vendor is called and nothing hits
// the network — the dummy Hunter key merely lets that instance build.
const bootChain = (env: Record<string, string>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* EnrichmentChain
		}).pipe(
			Effect.provide(
				enrichmentLayer.pipe(
					Layer.provide(FetchHttpClient.layer),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
				),
			),
		),
	)

const labelsOf = (chain: {
	readonly attempts: ReadonlyArray<{ readonly label: string }>
}): string[] => chain.attempts.map(a => a.label)

describe('enrichmentLayer chain assembly', () => {
	describe('when one vendor is configured', () => {
		it('should build a single labelled attempt and default to fallback mode', async () => {
			// GIVEN only the stub enrich vendor, with the mode unset
			const chain = await bootChain({ RESEARCH_PROVIDER_ENRICH: 'stub' })
			// THEN one attempt named by the vendor, and the cheaper default mode
			expect(labelsOf(chain)).toEqual(['stub'])
			expect(chain.mode).toBe('fallback')
		})
	})

	describe('when several vendors are configured', () => {
		it('should keep the attempts in configured order', async () => {
			// GIVEN a two-vendor chain (a dummy key lets Hunter's instance build)
			const chain = await bootChain({
				RESEARCH_PROVIDER_ENRICH: 'hunter,stub',
				RESEARCH_API_KEY_ENRICH: 'dummy',
			})
			// THEN the waterfall will try them in the order the operator wrote
			expect(labelsOf(chain)).toEqual(['hunter', 'stub'])
		})
	})

	describe('when a slot is disabled', () => {
		it('should contribute no attempt for a none slot', async () => {
			// GIVEN a real vendor followed by an explicit none
			const chain = await bootChain({ RESEARCH_PROVIDER_ENRICH: 'stub,none' })
			// THEN none adds nothing — no charge and no call for it
			expect(labelsOf(chain)).toEqual(['stub'])
		})

		it('should build an empty chain when enrichment is unconfigured', async () => {
			// GIVEN no RESEARCH_PROVIDER_ENRICH at all (defaults to none)
			const chain = await bootChain({})
			// THEN there are no attempts, so discovery never charges enrichment
			expect(labelsOf(chain)).toEqual([])
		})
	})

	describe('when union mode is selected', () => {
		it('should read union from RESEARCH_ENRICH_MODE', async () => {
			// GIVEN the union-mode override
			const chain = await bootChain({
				RESEARCH_PROVIDER_ENRICH: 'stub',
				RESEARCH_ENRICH_MODE: 'union',
			})
			// THEN the chain carries union so the caller runs every vendor and merges
			expect(chain.mode).toBe('union')
		})
	})
})

describe('which vendor a capability would really answer with', () => {
	const readCapabilities = (
		env: Record<string, string>,
		only?: ReadonlyArray<ResearchCapability>,
	) =>
		Effect.runPromiseExit(
			resolvedCapabilityVendors(only).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	const vendorOf = (
		exit: Exit.Exit<ReadonlyArray<ResolvedCapability>, unknown>,
		capability: ResearchCapability,
	): string | undefined =>
		Exit.isSuccess(exit)
			? exit.value.find(entry => entry.capability === capability)?.vendor
			: undefined

	const LIVE = {
		RESEARCH_PROVIDER_SEARCH: 'brave',
		RESEARCH_PROVIDER_SCRAPE: 'firecrawl',
	}

	describe('when a capability names a real vendor', () => {
		it('should name that vendor', async () => {
			// GIVEN search and scrape pointed at real vendors
			const exit = await readCapabilities(LIVE)

			// WHEN read — THEN each reports what would answer for it
			expect(vendorOf(exit, 'search')).toBe('brave')
			expect(vendorOf(exit, 'scrape')).toBe('firecrawl')
		})
	})

	describe('when a capability nobody set has a default', () => {
		it('should read as off rather than failing', async () => {
			// GIVEN nothing said about site discovery, enrichment or verification
			const exit = await readCapabilities(LIVE)

			// WHEN read — THEN they come back off, which is what their own layers do
			// with the same silence; only a canned vendor would be a problem, and off
			// returns nothing rather than something invented
			expect(vendorOf(exit, 'map')).toBe('none')
			expect(vendorOf(exit, 'enrich')).toBe('none')
			expect(vendorOf(exit, 'verify')).toBe('none')
		})
	})

	describe('when a capability is answered by canned data', () => {
		it('should report the stub, including behind a real vendor', async () => {
			// GIVEN search stubbed outright and scrape stubbed ahead of a real vendor
			const exit = await readCapabilities({
				RESEARCH_PROVIDER_SEARCH: 'stub',
				RESEARCH_PROVIDER_SCRAPE: 'stub,firecrawl',
			})

			// WHEN read — THEN both report the stub, because the first choice is what
			// a call reaches
			expect(vendorOf(exit, 'search')).toBe('stub')
			expect(vendorOf(exit, 'scrape')).toBe('stub')
		})
	})

	describe('when a required capability was never set', () => {
		it('should fail naming the setting', async () => {
			// GIVEN nothing said about search, which carries no default
			const exit = await readCapabilities({
				RESEARCH_PROVIDER_SCRAPE: 'firecrawl',
			})

			// WHEN read — THEN it says which setting is missing rather than guessing
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain('RESEARCH_PROVIDER_SEARCH')
			}
		})
	})

	describe('when only some capabilities are asked about', () => {
		it('should read those alone, not the ones nobody asked for', async () => {
			// GIVEN enrichment configured and nothing said about search or scrape,
			// which is what an environment for contact discovery looks like — it is
			// handed a domain and never searches
			const exit = await readCapabilities(
				{ RESEARCH_PROVIDER_ENRICH: 'hunter' },
				['enrich'],
			)

			// WHEN only enrichment is asked about — THEN it answers, rather than
			// failing for want of a setting behind a capability it was not asked
			// about and the caller never reaches
			expect(Exit.isSuccess(exit)).toBe(true)
			expect(vendorOf(exit, 'enrich')).toBe('hunter')
		})
	})
})

describe('where the vendors a capability is pointed at answer', () => {
	const readEndpoints = (
		env: Record<string, string>,
		only?: ReadonlyArray<ResearchCapability>,
	) =>
		Effect.runPromiseExit(
			configuredCapabilityEndpoints(only).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	const endpointsOf = (
		exit: Exit.Exit<ReadonlyArray<CapabilityEndpoint>, unknown>,
	): ReadonlyArray<CapabilityEndpoint> =>
		Exit.isSuccess(exit) ? exit.value : []

	const LIVE = {
		RESEARCH_PROVIDER_SEARCH: 'brave',
		RESEARCH_PROVIDER_SCRAPE: 'firecrawl',
	}

	describe('when a capability names a real vendor', () => {
		it('should give the host it answers on, without the API path', async () => {
			// GIVEN search and scrape pointed at real vendors
			// WHEN read
			expect(endpointsOf(await readEndpoints(LIVE))).toEqual([
				{
					capability: 'search',
					slot: 1,
					vendor: 'brave',
					origin: 'https://api.search.brave.com',
				},
				{
					capability: 'scrape',
					slot: 1,
					vendor: 'firecrawl',
					origin: 'https://api.firecrawl.dev',
				},
			])
		})
	})

	describe('when a capability falls back to a second vendor', () => {
		it('should give both, numbered by the order a call reaches them', async () => {
			// GIVEN a search cascade of two vendors
			const found = endpointsOf(
				await readEndpoints(
					{ ...LIVE, RESEARCH_PROVIDER_SEARCH: 'firecrawl,brave-context' },
					['search'],
				),
			)

			// WHEN read — THEN the fallback is there too, since a blocked second
			// vendor stays hidden until the first one is already struggling
			expect(found.map(entry => [entry.slot, entry.origin])).toEqual([
				[1, 'https://api.firecrawl.dev'],
				[2, 'https://api.search.brave.com'],
			])
		})
	})

	describe('when a capability answers from canned data or is switched off', () => {
		it('should give nothing for it, since it reaches no vendor', async () => {
			// GIVEN search stubbed and everything with a default left unset
			const found = endpointsOf(
				await readEndpoints({
					RESEARCH_PROVIDER_SEARCH: 'stub',
					RESEARCH_PROVIDER_SCRAPE: 'firecrawl',
				}),
			)

			// WHEN read — THEN only the vendor that would really be called is there;
			// nothing is probed on behalf of canned data or an off switch
			expect(found.map(entry => entry.capability)).toEqual(['scrape'])
		})

		it('should skip a canned first choice and still give the vendor behind it', async () => {
			// GIVEN a stub ahead of a real vendor
			const found = endpointsOf(
				await readEndpoints(
					{ ...LIVE, RESEARCH_PROVIDER_SCRAPE: 'stub,firecrawl' },
					['scrape'],
				),
			)

			// WHEN read — THEN the stub contributes nothing and the real vendor keeps
			// the slot number it occupies in the setting
			expect(found).toEqual([
				{
					capability: 'scrape',
					slot: 2,
					vendor: 'firecrawl',
					origin: 'https://api.firecrawl.dev',
				},
			])
		})
	})

	describe('when a capability was never set at all', () => {
		it('should give nothing for it rather than failing', async () => {
			// GIVEN nothing said about search, which carries no default. Unlike
			// reading its vendor — which guards a run and must refuse — this only
			// ever reports, and a setting nobody wrote reaches nothing
			const found = endpointsOf(
				await readEndpoints({ RESEARCH_PROVIDER_SCRAPE: 'firecrawl' }),
			)

			// WHEN read — THEN scrape still answers, instead of being lost with it
			expect(found.map(entry => entry.capability)).toEqual(['scrape'])
		})
	})

	describe('when a capability was set to something that will not read', () => {
		it('should fail naming the setting, so a typo is not read as unset', async () => {
			// GIVEN a mistyped vendor name — the setting exists and is wrong, which
			// is a fault rather than a machine nobody configured
			const exit = await readEndpoints({
				RESEARCH_PROVIDER_SEARCH: 'firecrwal',
				RESEARCH_PROVIDER_SCRAPE: 'firecrawl',
			})

			// WHEN read — THEN it says which setting is at fault
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain('RESEARCH_PROVIDER_SEARCH')
			}
		})
	})
})

describe('where the company register a country is pointed at answers', () => {
	const readRegistries = (
		env: Record<string, string>,
		only?: ReadonlyArray<RegistryCountry>,
	) =>
		Effect.runPromiseExit(
			configuredRegistryEndpoints(only).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	const registriesOf = (
		exit: Exit.Exit<ReadonlyArray<RegistryEndpoint>, unknown>,
	): ReadonlyArray<RegistryEndpoint> => (Exit.isSuccess(exit) ? exit.value : [])

	describe('when countries name real registers', () => {
		it('should give each one its host, since a country can be blocked alone', async () => {
			// GIVEN both countries pointed at their national register
			const found = registriesOf(
				await readRegistries({
					RESEARCH_PROVIDER_REGISTRY_ES: 'librebor',
					RESEARCH_PROVIDER_REGISTRY_GB: 'companies-house',
				}),
			)

			// WHEN read — THEN both are there, so reaching the Spanish one says
			// nothing about the British one
			expect(found.map(entry => [entry.country, entry.origin])).toEqual([
				['ES', 'https://api.librebor.me'],
				['GB', 'https://api.company-information.service.gov.uk'],
			])
		})
	})

	describe('when a country is switched off, stubbed or never set', () => {
		it('should give nothing for it', async () => {
			// GIVEN Spain switched off and Britain on canned data
			const found = registriesOf(
				await readRegistries({
					RESEARCH_PROVIDER_REGISTRY_ES: 'none',
					RESEARCH_PROVIDER_REGISTRY_GB: 'stub',
				}),
			)

			// WHEN read — THEN neither reaches a register, so neither is asked about
			expect(found).toEqual([])
			// AND a country nobody set at all is the same, rather than a failure
			expect(registriesOf(await readRegistries({}))).toEqual([])
		})
	})

	describe('when a country was set to something that will not read', () => {
		it('should fail naming the setting, so a typo is not read as switched off', async () => {
			// GIVEN a mistyped register name for Spain
			const exit = await readRegistries({
				RESEARCH_PROVIDER_REGISTRY_ES: 'libreborme',
			})

			// WHEN read — THEN it says which setting is at fault
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain(
					'RESEARCH_PROVIDER_REGISTRY_ES',
				)
			}
		})
	})
})
