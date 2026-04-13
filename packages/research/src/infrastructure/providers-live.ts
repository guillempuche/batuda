/**
 * Boot-time provider selection layer for all 6 research capabilities.
 *
 * Reads RESEARCH_*_PROVIDER env vars at startup via Config.schema and
 * returns the matching Layer for each capability. Uses the same
 * Layer.unwrap + Config.schema pattern as EmailProviderLive.
 *
 * @see apps/server/src/services/email-provider-live.ts for the template
 */

import { Config, Effect, Layer, Schema } from 'effect'

import {
	DiscoverProvider,
	ExtractProvider,
	RegistryRouter,
	ReportRouter,
	ScrapeProvider,
	SearchProvider,
} from '../application/ports'
import { disabledError, notYetImplementedError } from './_shared'
import { BraveSearchProvider } from './brave/search'
import { makeCachedSearch } from './cached-search'
import { StubDiscoverProvider } from './stub/discover'
import { StubExtractProvider } from './stub/extract'
import { StubRegistryEsProvider } from './stub/registry-es'
import { StubReportEsProvider } from './stub/report-es'
import { StubScrapeProvider } from './stub/scrape'
import { StubSearchProvider } from './stub/search'

// ── Search (with cache wrapper) ──

const searchLayer = Layer.unwrap(
	Effect.gen(function* () {
		const p = yield* Config.schema(
			Schema.Literals(['stub', 'brave', 'firecrawl']),
			'RESEARCH_SEARCH_PROVIDER',
		)
		yield* Effect.logInfo(`research.search: ${p}`)
		switch (p) {
			case 'stub':
				return StubSearchProvider
			case 'brave':
				return BraveSearchProvider
			case 'firecrawl':
				return Layer.succeed(SearchProvider)(
					SearchProvider.of({
						search: () => notYetImplementedError('search', 'firecrawl'),
					}),
				)
		}
	}),
)
const cachedSearchLayer = makeCachedSearch().pipe(Layer.provide(searchLayer))

// ── Scrape ──

const scrapeLayer = Layer.unwrap(
	Effect.gen(function* () {
		const p = yield* Config.schema(
			Schema.Literals(['stub', 'firecrawl', 'local']),
			'RESEARCH_SCRAPE_PROVIDER',
		)
		yield* Effect.logInfo(`research.scrape: ${p}`)
		switch (p) {
			case 'stub':
				return StubScrapeProvider
			case 'firecrawl':
				return Layer.succeed(ScrapeProvider)(
					ScrapeProvider.of({
						scrape: () => notYetImplementedError('scrape', 'firecrawl'),
					}),
				)
			case 'local':
				return Layer.succeed(ScrapeProvider)(
					ScrapeProvider.of({
						scrape: () => notYetImplementedError('scrape', 'local'),
					}),
				)
		}
	}),
)

// ── Extract ──

const extractLayer = Layer.unwrap(
	Effect.gen(function* () {
		const p = yield* Config.schema(
			Schema.Literals(['stub', 'firecrawl', 'local']),
			'RESEARCH_EXTRACT_PROVIDER',
		)
		yield* Effect.logInfo(`research.extract: ${p}`)
		switch (p) {
			case 'stub':
				return StubExtractProvider
			case 'firecrawl':
				return Layer.succeed(ExtractProvider)(
					ExtractProvider.of({
						extract: () => notYetImplementedError('extract', 'firecrawl'),
					}),
				)
			case 'local':
				return Layer.succeed(ExtractProvider)(
					ExtractProvider.of({
						extract: () => notYetImplementedError('extract', 'local'),
					}),
				)
		}
	}),
)

// ── Discover ──

const discoverLayer = Layer.unwrap(
	Effect.gen(function* () {
		const p = yield* Config.schema(
			Schema.Literals(['stub', 'firecrawl', 'anthropic', 'none']),
			'RESEARCH_DISCOVER_PROVIDER',
		)
		yield* Effect.logInfo(`research.discover: ${p}`)
		switch (p) {
			case 'stub':
				return StubDiscoverProvider
			case 'none':
				return Layer.succeed(DiscoverProvider)(
					DiscoverProvider.of({
						discover: () => disabledError('discover'),
						cancel: () => disabledError('discover'),
					}),
				)
			case 'firecrawl':
				return Layer.succeed(DiscoverProvider)(
					DiscoverProvider.of({
						discover: () => notYetImplementedError('discover', 'firecrawl'),
						cancel: () => notYetImplementedError('discover', 'firecrawl'),
					}),
				)
			case 'anthropic':
				return Layer.succeed(DiscoverProvider)(
					DiscoverProvider.of({
						discover: () => notYetImplementedError('discover', 'anthropic'),
						cancel: () => notYetImplementedError('discover', 'anthropic'),
					}),
				)
		}
	}),
)

// ── Registry (ES) ──

const registryEsLayer = Layer.unwrap(
	Effect.gen(function* () {
		const p = yield* Config.schema(
			Schema.Literals(['stub', 'librebor', 'none']),
			'RESEARCH_REGISTRY_PROVIDER_ES',
		)
		yield* Effect.logInfo(`research.registry.es: ${p}`)
		switch (p) {
			case 'stub':
				return StubRegistryEsProvider
			case 'none':
				return Layer.succeed(RegistryRouter)(
					RegistryRouter.of({
						lookup: () => disabledError('registry'),
					}),
				)
			case 'librebor':
				return Layer.succeed(RegistryRouter)(
					RegistryRouter.of({
						lookup: () => notYetImplementedError('registry', 'librebor'),
					}),
				)
		}
	}),
)

// ── Report (ES) ──

const reportEsLayer = Layer.unwrap(
	Effect.gen(function* () {
		const p = yield* Config.schema(
			Schema.Literals(['stub', 'einforma', 'none']),
			'RESEARCH_REPORT_PROVIDER_ES',
		)
		yield* Effect.logInfo(`research.report.es: ${p}`)
		switch (p) {
			case 'stub':
				return StubReportEsProvider
			case 'none':
				return Layer.succeed(ReportRouter)(
					ReportRouter.of({
						report: () => disabledError('report'),
					}),
				)
			case 'einforma':
				return Layer.succeed(ReportRouter)(
					ReportRouter.of({
						report: () => notYetImplementedError('report', 'einforma'),
					}),
				)
		}
	}),
)

// ── Merged layer ──

export const makeResearchProvidersLive = Layer.mergeAll(
	cachedSearchLayer,
	scrapeLayer,
	extractLayer,
	discoverLayer,
	registryEsLayer,
	reportEsLayer,
)
