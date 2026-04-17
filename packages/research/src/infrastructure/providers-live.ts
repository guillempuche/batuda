/**
 * Boot-time provider selection layer for all 6 research capabilities.
 *
 * For each capability, reads a `RESEARCH_PROVIDER_*` comma list at startup
 * (non-empty, literal-validated by Schema), builds one service instance per
 * slot from per-vendor factories, and composes them via `withFallback` when
 * the list has more than one entry. Registry and Report dispatch per
 * ISO-3166-1 country code; adding a new country is one entry in
 * `domain/country.ts`.
 */

import { Effect, Layer } from 'effect'

import {
	type DiscoverInput,
	DiscoverProvider,
	type ExtractInput,
	ExtractProvider,
	type RegistryInput,
	RegistryRouter,
	type ReportInput,
	ReportRouter,
	type ScrapeInput,
	ScrapeProvider,
	type SearchInput,
	SearchProvider,
} from '../application/ports'
import {
	type Country,
	REGISTRY_VENDORS_BY_COUNTRY,
	REPORT_VENDORS_BY_COUNTRY,
	SUPPORTED_COUNTRIES,
} from '../domain/country'
import type { ProviderError } from '../domain/errors'
import type {
	CompanyReport,
	DiscoverResult,
	ExternalJobRef,
	RegistryRecord,
	ScrapedPage,
	SearchResult,
} from '../domain/types'
import { providerListConfig } from './_config'
import { withFallback } from './_fallback'
import { disabledError, notYetImplementedError } from './_shared'
import { makeBraveSearch } from './brave/search'
import { makeCachedSearch } from './cached-search'
import { StubDiscoverProviderInstance } from './stub/discover'
import { StubExtractProviderInstance } from './stub/extract'
import { StubRegistryEsProviderInstance } from './stub/registry-es'
import { StubReportEsProviderInstance } from './stub/report-es'
import { StubScrapeProviderInstance } from './stub/scrape'
import { StubSearchProviderInstance } from './stub/search'

// ── Vendor literal unions ──

const SEARCH_VENDORS = ['stub', 'brave', 'firecrawl'] as const
const SCRAPE_VENDORS = ['stub', 'firecrawl', 'local'] as const
const EXTRACT_VENDORS = ['stub', 'firecrawl', 'local'] as const
const DISCOVER_VENDORS = ['stub', 'firecrawl', 'anthropic', 'none'] as const

type SearchVendor = (typeof SEARCH_VENDORS)[number]
type ScrapeVendor = (typeof SCRAPE_VENDORS)[number]
type ExtractVendor = (typeof EXTRACT_VENDORS)[number]
type DiscoverVendor = (typeof DISCOVER_VENDORS)[number]

// ── Per-capability instance factories ──

const searchInstance = (vendor: SearchVendor, slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubSearchProviderInstance)
		case 'brave':
			return makeBraveSearch(slot)
		case 'firecrawl':
			return Effect.succeed(
				SearchProvider.of({
					search: () => notYetImplementedError('search', 'firecrawl'),
				}),
			)
	}
}

const scrapeInstance = (vendor: ScrapeVendor, _slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubScrapeProviderInstance)
		case 'firecrawl':
			return Effect.succeed(
				ScrapeProvider.of({
					scrape: () => notYetImplementedError('scrape', 'firecrawl'),
				}),
			)
		case 'local':
			return Effect.succeed(
				ScrapeProvider.of({
					scrape: () => notYetImplementedError('scrape', 'local'),
				}),
			)
	}
}

const extractInstance = (vendor: ExtractVendor, _slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubExtractProviderInstance)
		case 'firecrawl':
			return Effect.succeed(
				ExtractProvider.of({
					extract: () => notYetImplementedError('extract', 'firecrawl'),
				}),
			)
		case 'local':
			return Effect.succeed(
				ExtractProvider.of({
					extract: () => notYetImplementedError('extract', 'local'),
				}),
			)
	}
}

const discoverInstance = (vendor: DiscoverVendor, _slot: number) => {
	switch (vendor) {
		case 'stub':
			return Effect.succeed(StubDiscoverProviderInstance)
		case 'none':
			return Effect.succeed(
				DiscoverProvider.of({
					discover: () => disabledError('discover'),
					cancel: () => disabledError('discover'),
				}),
			)
		case 'firecrawl':
			return Effect.succeed(
				DiscoverProvider.of({
					discover: () => notYetImplementedError('discover', 'firecrawl'),
					cancel: () => notYetImplementedError('discover', 'firecrawl'),
				}),
			)
		case 'anthropic':
			return Effect.succeed(
				DiscoverProvider.of({
					discover: () => notYetImplementedError('discover', 'anthropic'),
					cancel: () => notYetImplementedError('discover', 'anthropic'),
				}),
			)
	}
}

const registryInstance = (cc: Country, vendor: string, _slot: number) => {
	if (cc === 'ES') {
		switch (vendor as (typeof REGISTRY_VENDORS_BY_COUNTRY)['ES'][number]) {
			case 'stub':
				return Effect.succeed(StubRegistryEsProviderInstance)
			case 'librebor':
				return Effect.succeed(
					RegistryRouter.of({
						lookup: () => notYetImplementedError('registry', 'librebor'),
					}),
				)
			case 'none':
				return Effect.succeed(
					RegistryRouter.of({
						lookup: () => disabledError('registry'),
					}),
				)
		}
	}
	const _exhaust: never = cc
	return _exhaust
}

const reportInstance = (cc: Country, vendor: string, _slot: number) => {
	if (cc === 'ES') {
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
					ReportRouter.of({
						report: () => disabledError('report'),
					}),
				)
		}
	}
	const _exhaust: never = cc
	return _exhaust
}

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
			vendors.map((vendor, slot) => searchInstance(vendor, slot)),
		)
		if (instances.length === 1) return instances[0]!
		const search = withFallback(
			instances,
			(svc, input: SearchInput): Effect.Effect<SearchResult, ProviderError> =>
				svc.search(input),
		)
		return SearchProvider.of({ search })
	}),
)

const cachedSearchLayer = makeCachedSearch().pipe(Layer.provide(searchLayer))

const scrapeLayer = Layer.effect(
	ScrapeProvider,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			SCRAPE_VENDORS,
			'RESEARCH_PROVIDER_SCRAPE',
		)
		yield* Effect.logInfo(`research.scrape: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => scrapeInstance(vendor, slot)),
		)
		if (instances.length === 1) return instances[0]!
		const scrape = withFallback(
			instances,
			(svc, input: ScrapeInput): Effect.Effect<ScrapedPage, ProviderError> =>
				svc.scrape(input),
		)
		return ScrapeProvider.of({ scrape })
	}),
)

const extractLayer = Layer.effect(
	ExtractProvider,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			EXTRACT_VENDORS,
			'RESEARCH_PROVIDER_EXTRACT',
		)
		yield* Effect.logInfo(`research.extract: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => extractInstance(vendor, slot)),
		)
		if (instances.length === 1) return instances[0]!
		const extract = withFallback(
			instances,
			(svc, input: ExtractInput): Effect.Effect<unknown, ProviderError> =>
				svc.extract(input),
		)
		return ExtractProvider.of({ extract })
	}),
)

const discoverLayer = Layer.effect(
	DiscoverProvider,
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			DISCOVER_VENDORS,
			'RESEARCH_PROVIDER_DISCOVER',
		)
		yield* Effect.logInfo(`research.discover: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => discoverInstance(vendor, slot)),
		)
		if (instances.length === 1) return instances[0]!
		const discover = withFallback(
			instances,
			(
				svc,
				input: DiscoverInput,
			): Effect.Effect<DiscoverResult, ProviderError> => svc.discover(input),
		)
		const cancel = withFallback(
			instances,
			(svc, jobRef: ExternalJobRef): Effect.Effect<void, ProviderError> =>
				svc.cancel(jobRef),
		)
		return DiscoverProvider.of({ discover, cancel })
	}),
)

// ── Country-dispatching layers for registry + report ──

const buildRegistryDispatcher = (cc: Country) =>
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			REGISTRY_VENDORS_BY_COUNTRY[cc],
			`RESEARCH_PROVIDER_REGISTRY_${cc}`,
		)
		yield* Effect.logInfo(`research.registry.${cc}: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => registryInstance(cc, vendor, slot)),
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
			): Effect.Effect<RegistryRecord, ProviderError> => svc.lookup(input),
		)
	})

const buildReportDispatcher = (cc: Country) =>
	Effect.gen(function* () {
		const vendors = yield* providerListConfig(
			REPORT_VENDORS_BY_COUNTRY[cc],
			`RESEARCH_PROVIDER_REPORT_${cc}`,
		)
		yield* Effect.logInfo(`research.report.${cc}: ${vendors.join(',')}`)
		const instances = yield* Effect.all(
			vendors.map((vendor, slot) => reportInstance(cc, vendor, slot)),
		)
		if (instances.length === 1) {
			const head = instances[0]!
			return (input: ReportInput) => head.report(input)
		}
		return withFallback(
			instances,
			(svc, input: ReportInput): Effect.Effect<CompanyReport, ProviderError> =>
				svc.report(input),
		)
	})

const registryLayer = Layer.effect(
	RegistryRouter,
	Effect.gen(function* () {
		const byCountry = {} as Record<
			Country,
			(input: RegistryInput) => Effect.Effect<RegistryRecord, ProviderError>
		>
		for (const cc of SUPPORTED_COUNTRIES) {
			byCountry[cc] = yield* buildRegistryDispatcher(cc)
		}
		return RegistryRouter.of({
			lookup: input => {
				const invoke = byCountry[input.country]
				return invoke ? invoke(input) : disabledError('registry')
			},
		})
	}),
)

const reportLayer = Layer.effect(
	ReportRouter,
	Effect.gen(function* () {
		const byCountry = {} as Record<
			Country,
			(input: ReportInput) => Effect.Effect<CompanyReport, ProviderError>
		>
		for (const cc of SUPPORTED_COUNTRIES) {
			byCountry[cc] = yield* buildReportDispatcher(cc)
		}
		return ReportRouter.of({
			report: input => {
				const invoke = byCountry[input.country]
				return invoke ? invoke(input) : disabledError('report')
			},
		})
	}),
)

// ── Merged layer ──

export const makeResearchProvidersLive = Layer.mergeAll(
	cachedSearchLayer,
	scrapeLayer,
	extractLayer,
	discoverLayer,
	registryLayer,
	reportLayer,
)
