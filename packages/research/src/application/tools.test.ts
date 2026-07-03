import { Effect, Layer, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { RegistryRecord, ScrapedPage, SearchResult } from '../domain/types'
import { StubExtractProvider } from '../infrastructure/stub/extract'
import { StubRegistryEsProvider } from '../infrastructure/stub/registry-es'
import { StubScrapeProvider } from '../infrastructure/stub/scrape'
import { StubSearchProvider } from '../infrastructure/stub/search'
import {
	type ExtractInput,
	ExtractProvider,
	type RegistryInput,
	RegistryRouter,
	type ScrapeInput,
	ScrapeProvider,
	type SearchInput,
	SearchProvider,
} from './ports'
import {
	ExtractStructuredTool,
	RegistryLookupTool,
	researchToolkit,
	researchToolkitLayer,
	ScrapePageTool,
	WebSearchTool,
} from './tools'

// ── Test harness ──
// Each helper drives one tool through the real toolkit. `researchToolkit.handle`
// decodes the raw params with the tool's own parameter schema — the exact path
// that rejected a model-emitted `null` before this fix — then runs the handler
// on a forked fiber. Draining the result stream forces that handler to run, so
// the capturing port stub records the input the handler actually built. The
// three ports not under test are the shared deterministic stubs.

const webSearchInput = async (params: {
	query: string
	limit?: number | null
	recency_days?: number | null
	location?: string | null
}): Promise<SearchInput> => {
	let captured: SearchInput | undefined
	const ports = Layer.mergeAll(
		Layer.succeed(SearchProvider)(
			SearchProvider.of({
				search: input => {
					captured = input
					return Effect.succeed(new SearchResult({ items: [], units: 0 }))
				},
			}),
		),
		StubScrapeProvider,
		StubExtractProvider,
		StubRegistryEsProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('web_search', params)
			yield* Stream.runDrain(stream)
		}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports)))),
	)
	if (captured === undefined) {
		throw new Error('web_search handler never called the search provider')
	}
	return captured
}

const registryLookupInput = async (params: {
	country: 'ES' | 'GB'
	query?: string | null
	tax_id?: string | null
}): Promise<RegistryInput> => {
	let captured: RegistryInput | undefined
	const ports = Layer.mergeAll(
		Layer.succeed(RegistryRouter)(
			RegistryRouter.of({
				lookup: input => {
					captured = input
					return Effect.succeed(
						new RegistryRecord({ legalName: 'ACME', units: 0 }),
					)
				},
			}),
		),
		StubSearchProvider,
		StubScrapeProvider,
		StubExtractProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('registry_lookup', params)
			yield* Stream.runDrain(stream)
		}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports)))),
	)
	if (captured === undefined) {
		throw new Error('registry_lookup handler never called the registry router')
	}
	return captured
}

const extractInput = async (params: {
	url: string
	schema_name: string
	prompt?: string | null
}): Promise<ExtractInput> => {
	let captured: ExtractInput | undefined
	const ports = Layer.mergeAll(
		Layer.succeed(ExtractProvider)(
			ExtractProvider.of({
				extract: input => {
					captured = input
					return Effect.succeed({})
				},
			}),
		),
		StubSearchProvider,
		StubScrapeProvider,
		StubRegistryEsProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('extract_structured', params)
			yield* Stream.runDrain(stream)
		}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports)))),
	)
	if (captured === undefined) {
		throw new Error(
			'extract_structured handler never called the extract provider',
		)
	}
	return captured
}

const scrapeInput = async (params: { url: string }): Promise<ScrapeInput> => {
	let captured: ScrapeInput | undefined
	const ports = Layer.mergeAll(
		Layer.succeed(ScrapeProvider)(
			ScrapeProvider.of({
				scrape: input => {
					captured = input
					return Effect.succeed(
						new ScrapedPage({ url: input.url, contentHash: 'h', units: 0 }),
					)
				},
			}),
		),
		StubSearchProvider,
		StubExtractProvider,
		StubRegistryEsProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('scrape_page', params)
			yield* Stream.runDrain(stream)
		}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports)))),
	)
	if (captured === undefined) {
		throw new Error('scrape_page handler never called the scrape provider')
	}
	return captured
}

describe('researchToolkit tool params — model-emitted null is treated as omitted', () => {
	describe('web_search handler', () => {
		describe('when the optional params are explicit null', () => {
			it('should hand the search provider undefined for limit, recency, and location', async () => {
				// GIVEN a model that emits null for every optional field it is not using
				// WHEN the web_search tool call is handled
				const input = await webSearchInput({
					query: 'acme corp',
					limit: null,
					recency_days: null,
					location: null,
				})

				// THEN the required query still arrives
				expect(input.query).toBe('acme corp')
				// AND each optional null is folded to "not provided"
				expect(input.limit).toBeUndefined()
				expect(input.recency).toBeUndefined()
				expect(input.location).toBeUndefined()
			})
		})

		describe('when the optional params carry real values', () => {
			it('should pass limit and location through and wrap recency_days as { days }', async () => {
				// GIVEN a fully specified search
				// WHEN handled
				const input = await webSearchInput({
					query: 'acme corp',
					limit: 5,
					recency_days: 7,
					location: 'ES',
				})

				// THEN the values reach the provider unchanged, recency as a { days } object
				expect(input.limit).toBe(5)
				expect(input.recency).toEqual({ days: 7 })
				expect(input.location).toBe('ES')
			})
		})

		describe('when the optional keys are omitted entirely', () => {
			it('should hand the search provider undefined (original optional-key behavior)', async () => {
				// GIVEN only the required query, all optional keys absent
				// WHEN handled
				const input = await webSearchInput({ query: 'acme corp' })

				// THEN the absent keys behave exactly like the null case
				expect(input.limit).toBeUndefined()
				expect(input.recency).toBeUndefined()
				expect(input.location).toBeUndefined()
			})
		})

		describe('when a falsy-but-valid value is given', () => {
			it('should keep recency_days: 0 as { days: 0 } — only null is folded, not zero', async () => {
				// GIVEN recency_days of 0 (a real value, distinct from "omitted")
				// WHEN handled
				const input = await webSearchInput({
					query: 'acme corp',
					recency_days: 0,
				})

				// THEN it is preserved because the guard tests for null, not truthiness
				// [recency_days != null]
				expect(input.recency).toEqual({ days: 0 })
			})

			it('should keep limit: 0 — ?? preserves zero', async () => {
				// GIVEN a limit of 0
				// WHEN handled
				const input = await webSearchInput({ query: 'acme corp', limit: 0 })

				// THEN zero survives (unlike a `|| undefined` would do) [limit ?? undefined]
				expect(input.limit).toBe(0)
			})

			it('should keep location as an empty string — only nullish is folded', async () => {
				// GIVEN an empty-string location
				// WHEN handled
				const input = await webSearchInput({ query: 'acme corp', location: '' })

				// THEN the empty string is a real value and is preserved
				expect(input.location).toBe('')
			})
		})
	})

	describe('registry_lookup handler', () => {
		describe('when query and tax_id are null', () => {
			it('should hand the router undefined for both, renaming tax_id to taxId', async () => {
				// GIVEN a model emitting null for the optional lookup fields
				// WHEN the registry_lookup tool call is handled
				const input = await registryLookupInput({
					country: 'ES',
					query: null,
					tax_id: null,
				})

				// THEN the required country arrives and both optionals fold to undefined
				expect(input.country).toBe('ES')
				expect(input.query).toBeUndefined()
				expect(input.taxId).toBeUndefined()
			})
		})

		describe('when tax_id carries a value', () => {
			it('should pass it through as taxId', async () => {
				// GIVEN a concrete tax id
				// WHEN handled
				const input = await registryLookupInput({
					country: 'ES',
					tax_id: 'B12345678',
				})

				// THEN it reaches the router under the renamed key
				expect(input.taxId).toBe('B12345678')
			})
		})

		describe('when query is an empty string', () => {
			it('should keep the empty string (only nullish is folded)', async () => {
				// GIVEN an empty-string query
				// WHEN handled
				const input = await registryLookupInput({ country: 'ES', query: '' })

				// THEN the empty string survives
				expect(input.query).toBe('')
			})
		})
	})

	describe('extract_structured handler', () => {
		describe('when prompt is null', () => {
			it('should hand the extractor undefined for prompt', async () => {
				// GIVEN a registered schema name and a null prompt
				// WHEN the extract_structured tool call is handled
				const input = await extractInput({
					url: 'https://acmecorp.es',
					schema_name: 'freeform',
					prompt: null,
				})

				// THEN the null prompt folds to undefined while schema wiring is preserved
				expect(input.prompt).toBeUndefined()
				expect(input.schemaName).toBe('freeform')
			})
		})

		describe('when prompt carries a value', () => {
			it('should pass it through', async () => {
				// GIVEN extra guidance for the extractor
				// WHEN handled
				const input = await extractInput({
					url: 'https://acmecorp.es',
					schema_name: 'freeform',
					prompt: 'focus on revenue figures',
				})

				// THEN the prompt reaches the extractor unchanged
				expect(input.prompt).toBe('focus on revenue figures')
			})
		})
	})

	describe('scrape_page handler (no optional params — unaffected by the fix)', () => {
		describe('when called with a url', () => {
			it('should pass the url through and request the markdown format', async () => {
				// GIVEN a url to scrape
				// WHEN handled
				const input = await scrapeInput({ url: 'https://acmecorp.es' })

				// THEN the url is forwarded and the format is fixed to markdown
				expect(input.url).toBe('https://acmecorp.es')
				expect(input.formats).toEqual(['markdown'])
			})
		})
	})

	describe('tool parameter schemas — decode contract', () => {
		describe('when an optional param is explicit null', () => {
			it('should decode without rejecting for every widened optional param', () => {
				// GIVEN the raw args a model sends with null for unused optionals — the
				// exact decode that threw "Expected number, got null" before the fix
				// WHEN each tool schema decodes them
				// THEN the null passes through instead of failing validation
				// [Schema.optionalKey(Schema.NullOr(...))]
				const web = Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
					query: 'acme',
					limit: null,
					recency_days: null,
					location: null,
				})
				expect(web.limit).toBeNull()
				expect(web.recency_days).toBeNull()
				expect(web.location).toBeNull()

				const extract = Schema.decodeUnknownSync(
					ExtractStructuredTool.parametersSchema,
				)({ url: 'https://x.test', schema_name: 'freeform', prompt: null })
				expect(extract.prompt).toBeNull()

				const registry = Schema.decodeUnknownSync(
					RegistryLookupTool.parametersSchema,
				)({ country: 'ES', query: null, tax_id: null })
				expect(registry.query).toBeNull()
				expect(registry.tax_id).toBeNull()
			})
		})

		describe('when an optional param has a wrong, non-null type', () => {
			it('should still reject — the schema was widened to null, not to anything', () => {
				// GIVEN a string where a number is expected
				// THEN decode still fails (null tolerance did not loosen the value type)
				expect(() =>
					Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
						query: 'acme',
						recency_days: 'soon',
					}),
				).toThrow()
				expect(() =>
					Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
						query: 'acme',
						limit: 'ten',
					}),
				).toThrow()
			})
		})

		describe('when a required field is null', () => {
			it('should reject — only the optional params were widened', () => {
				// GIVEN null for a required field
				// THEN decode fails, because required fields were left as bare String
				expect(() =>
					Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
						query: null,
					}),
				).toThrow()
				expect(() =>
					Schema.decodeUnknownSync(ScrapePageTool.parametersSchema)({
						url: null,
					}),
				).toThrow()
			})
		})
	})
})
