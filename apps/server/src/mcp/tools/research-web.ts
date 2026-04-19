import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import {
	Budget,
	DiscoverProvider,
	ExtractProvider,
	ProviderQuota,
	ScrapeProvider,
	SearchProvider,
} from '@batuda/research'

// ── web_search ──

const WebSearch = Tool.make('web_search', {
	description:
		'Search the web. Returns a list of URLs with titles and snippets. Use this as the first step to find information on a topic.',
	parameters: Schema.Struct({
		query: Schema.String,
		limit: Schema.optional(Schema.Number),
		recency_days: Schema.optional(Schema.Number),
		location: Schema.optional(Schema.String),
		languages: Schema.optional(Schema.Array(Schema.String)),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Web Search')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── web_read ──

const WebRead = Tool.make('web_read', {
	description:
		'Fetch a URL as markdown. Optionally pass a JSON schema to extract structured data instead of raw markdown. Use this to read the content of a page found via web_search.',
	parameters: Schema.Struct({
		url: Schema.String,
		schema: Schema.optional(Schema.Unknown),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Web Read')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── web_discover ──

const WebDiscover = Tool.make('web_discover', {
	description:
		'Autonomous browsing: follows links, reasons over pages, returns findings. Expensive — only use when web_search + web_read cannot answer the question.',
	parameters: Schema.Struct({
		prompt: Schema.String,
		urls: Schema.optional(Schema.Array(Schema.String)),
		max_cost_cents: Schema.optional(Schema.Number),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Web Discover')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Toolkit + handlers ──

export const ResearchWebTools = Toolkit.make(WebSearch, WebRead, WebDiscover)

export const ResearchWebHandlersLive = ResearchWebTools.toLayer(
	Effect.gen(function* () {
		const search = yield* SearchProvider
		const scrape = yield* ScrapeProvider
		const extract = yield* ExtractProvider
		const discover = yield* DiscoverProvider
		const quota = yield* ProviderQuota
		const budget = yield* Budget

		return {
			web_search: params =>
				Effect.gen(function* () {
					// Flow: quota check → budget charge → provider call → quota consume.
					yield* quota.check('search', 1)
					yield* budget.chargeCheap('search', 1) // 1 cent per search query
					const result = yield* search.search({
						query: params.query,
						limit: params.limit,
						recency: params.recency_days
							? { days: params.recency_days }
							: undefined,
						location: params.location,
						languages: params.languages ? [...params.languages] : undefined,
					})
					yield* quota.consume('search', result.units)
					return result
				}).pipe(Effect.orDie),

			web_read: params =>
				Effect.gen(function* () {
					if (params.schema) {
						// Structured extract costs 2x a plain scrape because the
						// provider runs LLM inference to match the schema.
						yield* quota.check('extract', 1)
						yield* budget.chargeCheap('extract', 2)
						const raw = yield* extract.extract({
							url: params.url,
							schema: params.schema as Schema.Top,
						})
						yield* quota.consume('extract', 1)
						return raw
					}
					yield* quota.check('scrape', 1)
					yield* budget.chargeCheap('scrape', 1) // 1 cent per page
					const page = yield* scrape.scrape({
						url: params.url,
						formats: ['markdown'],
					})
					yield* quota.consume('scrape', page.units)
					return page
				}).pipe(Effect.orDie),

			web_discover: params =>
				Effect.gen(function* () {
					// Autonomous browsing is expensive: charges 5 cents
					// upfront because it spawns its own multi-page session.
					yield* quota.check('discover', 5)
					yield* budget.chargeCheap('discover', 5)
					const result = yield* discover.discover({
						prompt: params.prompt,
						urls: params.urls ? [...params.urls] : undefined,
						maxCostCents: params.max_cost_cents,
					})
					yield* quota.consume('discover', result.units)
					return result
				}).pipe(Effect.orDie),
		}
	}),
)
