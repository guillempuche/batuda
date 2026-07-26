/**
 * Boot-time provider selection layer for all research capabilities.
 *
 * For each capability, reads a `RESEARCH_PROVIDER_*` comma list at startup
 * (non-empty, literal-validated by Schema), builds one service instance per
 * slot from per-vendor factories, and composes them via `withFallback` when
 * the list has more than one entry. Registry and Report dispatch per
 * ISO-3166-1 country code; adding a new country is one entry in
 * `domain/country.ts`.
 */

import { Config, Effect, Layer, Option, Schema } from 'effect'

import { priceUnitsMicrocents } from '../application/cost-rates'
import {
	EmailVerifier,
	type EmailVerifyInput,
	type EnrichmentAttempt,
	EnrichmentChain,
	EnrichmentProvider,
	MapProvider,
	type RegistryInput,
	RegistryRouter,
	type ReportInput,
	ReportRouter,
	type ScrapeInput,
	ScrapeProvider,
	type SearchInput,
	SearchProvider,
	type SiteMapInput,
	type SiteMapResult,
} from '../application/ports'
import { UsageMeter } from '../application/usage-meter'
import {
	isRegistryCountry,
	REGISTRY_COUNTRIES,
	REGISTRY_VENDORS_BY_COUNTRY,
	REPORT_VENDORS_BY_COUNTRY,
	type RegistryCountry,
} from '../domain/country'
import type {
	NoRegistry,
	ProviderError,
	UnsupportedSite,
} from '../domain/errors'
import type {
	CompanyReport,
	EmailVerification,
	RegistryRecord,
	ScrapedPage,
	SearchResult,
} from '../domain/types'
import { keyForSlot, providerListConfig } from './_config'
import { withFallback, withFallbackUntil } from './_fallback'
import {
	disabledError,
	noRegistryError,
	notYetImplementedError,
} from './_shared'
import { makeBraveLlmContextSearch } from './brave/llm-context'
import { makeBraveSearch } from './brave/search'
import { makeCachedScrape } from './cached-scrape'
import { makeCachedSearch } from './cached-search'
import { makeCompaniesHouseRegistry } from './companies-house/registry'
import { makeFirecrawlMap } from './firecrawl/map'
import { makeFirecrawlScrape } from './firecrawl/scrape'
import { makeFirecrawlSearch } from './firecrawl/search'
import { makeFullEnrichEnrichment } from './fullenrich/enrichment'
import { makeHunterEnrichment } from './hunter/enrichment'
import { makeHunterVerifier } from './hunter/verifier'
import { makeLibreborRegistry } from './librebor/registry'
import { MxResolverLive } from './mx-verify'
import { StubEnrichmentProviderInstance } from './stub/enrichment'
import { StubMapProviderInstance } from './stub/map'
import { StubRegistryEsProviderInstance } from './stub/registry-es'
import { StubRegistryGbProviderInstance } from './stub/registry-gb'
import { StubReportEsProviderInstance } from './stub/report-es'
import { StubScrapeProviderInstance } from './stub/scrape'
import { StubSearchProviderInstance } from './stub/search'
import { StubEmailVerifierInstance } from './stub/verifier'

// ── Vendor literal unions ──

const SEARCH_VENDORS = ['stub', 'brave', 'brave-context', 'firecrawl'] as const
const SCRAPE_VENDORS = ['stub', 'firecrawl', 'local'] as const
// 'none' is the default: site discovery only runs where a vendor is configured,
// so an unconfigured environment never injects stub pages into real evidence.
const MAP_VENDORS = ['stub', 'firecrawl', 'none'] as const
const ENRICH_VENDORS = ['stub', 'hunter', 'fullenrich', 'none'] as const
const VERIFY_VENDORS = ['stub', 'hunter', 'none'] as const

type SearchVendor = (typeof SEARCH_VENDORS)[number]
type ScrapeVendor = (typeof SCRAPE_VENDORS)[number]
type MapVendor = (typeof MAP_VENDORS)[number]
type EnrichVendor = (typeof ENRICH_VENDORS)[number]
type VerifyVendor = (typeof VERIFY_VENDORS)[number]

// ── What a provider slot charges ──

// Cents per credit for one slot. Required with no fallback, and per slot,
// because a search cascade can bill two different vendors for one query and they
// do not charge the same. A stub slot bills nobody, so it is free.
const slotUnitRate = (isStub: boolean, envPrefix: string, slot: number) =>
	isStub
		? Effect.succeed(0)
		: Config.finite(keyForSlot(`${envPrefix}_PRICE_CENTS_PER_UNIT`, slot))

/**
 * Record what a search or page fetch really cost, priced at that slot's rate.
 *
 * Wrapped around the vendor itself rather than around the cache above it, so a
 * cached answer costs nothing without a special case, and a query that cascades
 * to a second vendor records both — each provider bills for its own attempt.
 */
const withUnitMetering =
	<Input, Output extends { readonly units: number }, E>(
		call: (input: Input) => Effect.Effect<Output, E>,
		provider: string,
		port: 'search' | 'scrape' | 'map',
		centsPerUnit: number,
	) =>
	(input: Input): Effect.Effect<Output, E> =>
		call(input).pipe(
			Effect.tap(result =>
				Effect.serviceOption(UsageMeter).pipe(
					Effect.flatMap(meter =>
						Option.isSome(meter)
							? meter.value.recordUnits({
									provider,
									port,
									units: result.units,
									microcents: priceUnitsMicrocents(result.units, centsPerUnit),
								})
							: Effect.void,
					),
				),
			),
		)

// ── Per-capability instance factories ──

const searchInstance = (vendor: SearchVendor, slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubSearchProviderInstance)
		case 'brave':
			return makeBraveSearch(slot)
		case 'brave-context':
			return makeBraveLlmContextSearch(slot)
		case 'firecrawl':
			return makeFirecrawlSearch(slot)
	}
}

const scrapeInstance = (vendor: ScrapeVendor, slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubScrapeProviderInstance)
		case 'firecrawl':
			return makeFirecrawlScrape(slot)
		case 'local':
			return Effect.succeed(
				ScrapeProvider.of({
					scrape: () => notYetImplementedError('scrape', 'local'),
				}),
			)
	}
}

const mapInstance = (vendor: MapVendor, slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubMapProviderInstance)
		case 'firecrawl':
			return makeFirecrawlMap(slot)
		case 'none':
			return Effect.succeed(MapProvider.of({ map: () => disabledError('map') }))
	}
}

const enrichmentInstance = (vendor: EnrichVendor, slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubEnrichmentProviderInstance)
		case 'hunter':
			return makeHunterEnrichment(slot)
		case 'fullenrich':
			return makeFullEnrichEnrichment(slot)
		case 'none':
			return Effect.succeed(
				EnrichmentProvider.of({
					findPeople: () => disabledError('enrich'),
				}),
			)
	}
}

const verifierInstance = (vendor: VerifyVendor, slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubEmailVerifierInstance)
		case 'hunter':
			return makeHunterVerifier(slot)
		case 'none':
			return Effect.succeed(
				EmailVerifier.of({
					verify: () => disabledError('verify'),
				}),
			)
	}
}

// One builder per registry country. Keyed by RegistryCountry so adding a
// country is a new entry here plus its vendor-table row — no exhaustiveness
// switch to hand-edit. The inner switch selects the vendor within a country.
const REGISTRY_BUILDERS = {
	ES: (vendor: string, slot: number) => {
		switch (vendor as (typeof REGISTRY_VENDORS_BY_COUNTRY)['ES'][number]) {
			case 'stub':
				return Effect.succeed(StubRegistryEsProviderInstance)
			case 'librebor':
				return makeLibreborRegistry(slot)
			case 'none':
				return Effect.succeed(
					RegistryRouter.of({ lookup: () => disabledError('registry') }),
				)
		}
	},
	GB: (vendor: string, slot: number) => {
		switch (vendor as (typeof REGISTRY_VENDORS_BY_COUNTRY)['GB'][number]) {
			case 'stub':
				return Effect.succeed(StubRegistryGbProviderInstance)
			case 'companies-house':
				return makeCompaniesHouseRegistry(slot)
			case 'none':
				return Effect.succeed(
					RegistryRouter.of({ lookup: () => disabledError('registry') }),
				)
		}
	},
} satisfies Record<RegistryCountry, (vendor: string, slot: number) => unknown>

// One builder per country that can produce a paid report. Same data-driven
// shape as REGISTRY_BUILDERS.
const REPORT_BUILDERS = {
	ES: (vendor: string, _slot: number) => {
		switch (vendor as (typeof REPORT_VENDORS_BY_COUNTRY)['ES'][number]) {
			case 'stub':
				return Effect.succeed(StubReportEsProviderInstance)
			case 'einforma':
				return Effect.succeed(
					ReportRouter.of({
						report: () => notYetImplementedError('report', 'einforma'),
					}),
				)
			case 'none':
				return Effect.succeed(
					ReportRouter.of({ report: () => disabledError('report') }),
				)
		}
	},
	GB: (vendor: string, _slot: number) => {
		switch (vendor as (typeof REPORT_VENDORS_BY_COUNTRY)['GB'][number]) {
			case 'none':
				return Effect.succeed(
					ReportRouter.of({ report: () => disabledError('report') }),
				)
		}
	},
} satisfies Record<RegistryCountry, (vendor: string, slot: number) => unknown>

// ── Layer builders ──

const searchLayer = Layer.effect(
	SearchProvider,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			SEARCH_VENDORS,
			'RESEARCH_PROVIDER_SEARCH',
		)
		yield* Effect.logInfo(`research.search: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) =>
				Effect.gen(function* () {
					const instance = yield* searchInstance(vendor, slot)
					const centsPerUnit = yield* slotUnitRate(
						vendor === 'stub',
						'RESEARCH_PROVIDER_SEARCH',
						slot,
					)
					return SearchProvider.of({
						search: withUnitMetering(
							instance.search,
							vendor,
							'search',
							centsPerUnit,
						),
					})
				}),
			),
		)
		if (instances.length === 1) return instances[0]!
		// Search cascades on an empty result too, not only on error: a firecrawl
		// zero-hit falls through to the next vendor (e.g. brave-context), which often
		// has what the first missed.
		const search = withFallbackUntil(
			instances,
			(svc, input: SearchInput): Effect.Effect<SearchResult, ProviderError> =>
				svc.search(input),
			result => result.items.length === 0,
		)
		return SearchProvider.of({ search })
	}),
)

const cachedSearchLayer = makeCachedSearch().pipe(Layer.provide(searchLayer))

const cachedScrapeLayer = makeCachedScrape()

const scrapeLayer = Layer.effect(
	ScrapeProvider,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			SCRAPE_VENDORS,
			'RESEARCH_PROVIDER_SCRAPE',
		)
		yield* Effect.logInfo(`research.scrape: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) =>
				Effect.gen(function* () {
					const instance = yield* scrapeInstance(vendor, slot)
					const centsPerUnit = yield* slotUnitRate(
						vendor === 'stub',
						'RESEARCH_PROVIDER_SCRAPE',
						slot,
					)
					return ScrapeProvider.of({
						scrape: withUnitMetering(
							instance.scrape,
							vendor,
							'scrape',
							centsPerUnit,
						),
					})
				}),
			),
		)
		if (instances.length === 1) return instances[0]!
		const scrape = withFallback(
			instances,
			(
				svc,
				input: ScrapeInput,
				// UnsupportedSite passes through withFallback un-cascaded (every key
				// refuses the same site), so it never wastefully retries a second slot.
			): Effect.Effect<ScrapedPage, ProviderError | UnsupportedSite> =>
				svc.scrape(input),
		)
		return ScrapeProvider.of({ scrape })
	}),
)

const mapLayer = Layer.effect(
	MapProvider,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			MAP_VENDORS,
			'RESEARCH_PROVIDER_MAP',
			['none'] as const,
		)
		yield* Effect.logInfo(`research.map: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) =>
				Effect.gen(function* () {
					const instance = yield* mapInstance(vendor, slot)
					const centsPerUnit = yield* slotUnitRate(
						vendor === 'stub' || vendor === 'none',
						'RESEARCH_PROVIDER_MAP',
						slot,
					)
					return MapProvider.of({
						map: withUnitMetering(instance.map, vendor, 'map', centsPerUnit),
					})
				}),
			),
		)
		if (instances.length === 1) return instances[0]!
		const map = withFallback(
			instances,
			(svc, input: SiteMapInput): Effect.Effect<SiteMapResult, ProviderError> =>
				svc.map(input),
		)
		return MapProvider.of({ map })
	}),
)

export const enrichmentLayer = Layer.effect(
	EnrichmentChain,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			ENRICH_VENDORS,
			'RESEARCH_PROVIDER_ENRICH',
			['none'] as const,
		)
		const mode = yield* Config.schema(
			Schema.Literals(['fallback', 'union']),
			'RESEARCH_ENRICH_MODE',
		).pipe(Config.withDefault('fallback' as const))
		yield* Effect.logInfo(`research.enrich: ${vendors.join(',')} (${mode})`)
		// A 'none'/empty slot contributes no attempt — no charge, no call. The
		// original list index stays the slot so RESEARCH_API_KEY_ENRICH_2 keeps
		// naming the second vendor even when a 'none' precedes it.
		const attempts = yield* Effect.all(
			vendors.map((vendor, slot) =>
				vendor === 'none'
					? Effect.succeed(null)
					: enrichmentInstance(vendor, slot).pipe(
							Effect.map(
								(inst): EnrichmentAttempt => ({
									label: vendor,
									findPeople: inst.findPeople,
								}),
							),
						),
			),
		).pipe(
			Effect.map(xs => xs.filter((x): x is EnrichmentAttempt => x !== null)),
		)
		return EnrichmentChain.of({ attempts, mode })
	}),
)

const verifierLayer = Layer.effect(
	EmailVerifier,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			VERIFY_VENDORS,
			'RESEARCH_PROVIDER_VERIFY',
			['none'] as const,
		)
		yield* Effect.logInfo(`research.verify: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => verifierInstance(vendor, slot)),
		)
		if (instances.length === 1) return instances[0]!
		const verify = withFallback(
			instances,
			(
				svc,
				input: EmailVerifyInput,
			): Effect.Effect<EmailVerification, ProviderError> => svc.verify(input),
		)
		return EmailVerifier.of({ verify })
	}),
)

// ── Country-dispatching layers for registry + report ──

const buildRegistryDispatcher = (cc: RegistryCountry) =>
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			REGISTRY_VENDORS_BY_COUNTRY[cc],
			`RESEARCH_PROVIDER_REGISTRY_${cc}`,
			['none'] as const,
		)
		yield* Effect.logInfo(`research.registry.${cc}: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => REGISTRY_BUILDERS[cc](vendor, slot)),
		)
		if (instances.length === 1) {
			const head = instances[0]!
			return (input: RegistryInput) => head.lookup(input)
		}
		return withFallback(
			instances,
			(
				svc,
				input: RegistryInput,
			): Effect.Effect<RegistryRecord, ProviderError | NoRegistry> =>
				svc.lookup(input),
		)
	})

const buildReportDispatcher = (cc: RegistryCountry) =>
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			REPORT_VENDORS_BY_COUNTRY[cc],
			`RESEARCH_PROVIDER_REPORT_${cc}`,
			['none'] as const,
		)
		yield* Effect.logInfo(`research.report.${cc}: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => REPORT_BUILDERS[cc](vendor, slot)),
		)
		if (instances.length === 1) {
			const head = instances[0]!
			return (input: ReportInput) => head.report(input)
		}
		return withFallback(
			instances,
			(
				svc,
				input: ReportInput,
			): Effect.Effect<CompanyReport, ProviderError | NoRegistry> =>
				svc.report(input),
		)
	})

export const registryLayer = Layer.effect(
	RegistryRouter,
	Effect.gen(function* () {
		const byCountry = {} as Record<
			RegistryCountry,
			(
				input: RegistryInput,
			) => Effect.Effect<RegistryRecord, ProviderError | NoRegistry>
		>
		for (const cc of REGISTRY_COUNTRIES) {
			byCountry[cc] = yield* buildRegistryDispatcher(cc)
		}
		return RegistryRouter.of({
			// A registry country dispatches to its adapter; any other country is an
			// explicit no_registry outcome, not a hard failure.
			lookup: input =>
				isRegistryCountry(input.country)
					? byCountry[input.country](input)
					: noRegistryError(input.country),
		})
	}),
)

const reportLayer = Layer.effect(
	ReportRouter,
	Effect.gen(function* () {
		const byCountry = {} as Record<
			RegistryCountry,
			(
				input: ReportInput,
			) => Effect.Effect<CompanyReport, ProviderError | NoRegistry>
		>
		for (const cc of REGISTRY_COUNTRIES) {
			byCountry[cc] = yield* buildReportDispatcher(cc)
		}
		return ReportRouter.of({
			report: input =>
				isRegistryCountry(input.country)
					? byCountry[input.country](input)
					: noRegistryError(input.country),
		})
	}),
)

// ── Merged layer ──

export const makeResearchProvidersLive = Layer.mergeAll(
	cachedSearchLayer,
	cachedScrapeLayer.pipe(Layer.provide(scrapeLayer)),
	mapLayer,
	enrichmentLayer,
	verifierLayer,
	MxResolverLive,
	registryLayer,
	reportLayer,
)
