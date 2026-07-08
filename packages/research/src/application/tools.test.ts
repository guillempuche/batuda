import { Effect, Layer, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { NoRegistry, ProviderError } from '../domain/errors'
import { RegistryRecord, ScrapedPage, SearchResult } from '../domain/types'
import { StubExtractProvider } from '../infrastructure/stub/extract'
import { StubRegistryEsProvider } from '../infrastructure/stub/registry-es'
import { StubScrapeProvider } from '../infrastructure/stub/scrape'
import { StubSearchProvider } from '../infrastructure/stub/search'
import {
	ContactDiscovery,
	type DiscoverContactsInput,
} from './contact-discovery'
import {
	Budget,
	type ExtractInput,
	ExtractProvider,
	type RegistryInput,
	RegistryRouter,
	ResearchRunContext,
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

// Budget + run context the toolkit handlers now require. These tests exercise
// param mapping, not spend, so the charges are no-ops and the snapshot is
// generous enough that nothing is ever refused.
const stubBudget = Layer.succeed(Budget)(
	Budget.of({
		init: () => Effect.void,
		chargeCheap: () => Effect.void,
		chargePaid: () => Effect.void,
		snapshot: () =>
			Effect.succeed({
				cheapBudget: 1000,
				cheapSpent: 0,
				cheapRemaining: 1000,
				paidBudget: 1000,
				paidSpent: 0,
				paidRemaining: 1000,
			}),
	}),
)
const stubRunContext = Layer.succeed(ResearchRunContext)({
	researchId: 'test-run',
})
const testInfra = Layer.mergeAll(
	stubBudget,
	stubRunContext,
	Layer.succeed(ContactDiscovery)({
		discover: () =>
			Effect.succeed({
				status: 'no_reliable_contact' as const,
				researchId: 'test-run',
			}),
	}),
)

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
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	if (captured === undefined) {
		throw new Error('web_search handler never called the search provider')
	}
	return captured
}

const registryLookupInput = async (params: {
	country: string
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
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	if (captured === undefined) {
		throw new Error('registry_lookup handler never called the registry router')
	}
	return captured
}

// Drive registry_lookup with a custom router and return the tool's final result
// value — asserts what the model receives, not what the router was handed.
const registryLookupResult = async (
	lookup: (
		input: RegistryInput,
	) => Effect.Effect<RegistryRecord, ProviderError | NoRegistry>,
	params: { country: string; query?: string | null; tax_id?: string | null },
): Promise<unknown> => {
	const ports = Layer.mergeAll(
		Layer.succeed(RegistryRouter)(RegistryRouter.of({ lookup })),
		StubSearchProvider,
		StubScrapeProvider,
		StubExtractProvider,
	)
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('registry_lookup', params)
			return yield* Stream.runCollect(stream)
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	return results[results.length - 1]?.result
}

// Drive a web-fetch tool with a failing provider and return the final stream
// element, so a test can assert the model saw a failure (isFailure) rather than
// the run fiber being aborted.
const scrapePageResult = async (
	scrape: (input: ScrapeInput) => Effect.Effect<ScrapedPage, ProviderError>,
	params: { url: string },
): Promise<{ result: unknown; isFailure: boolean }> => {
	const ports = Layer.mergeAll(
		Layer.succeed(ScrapeProvider)(ScrapeProvider.of({ scrape })),
		StubSearchProvider,
		StubExtractProvider,
		StubRegistryEsProvider,
	)
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('scrape_page', params)
			return yield* Stream.runCollect(stream)
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	const last = results[results.length - 1]
	return { result: last?.result, isFailure: last?.isFailure ?? false }
}

const extractStructuredResult = async (
	extract: (input: ExtractInput) => Effect.Effect<unknown, ProviderError>,
	params: { url: string; schema_name: string },
): Promise<{ result: unknown; isFailure: boolean }> => {
	const ports = Layer.mergeAll(
		Layer.succeed(ExtractProvider)(ExtractProvider.of({ extract })),
		StubSearchProvider,
		StubScrapeProvider,
		StubRegistryEsProvider,
	)
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('extract_structured', params)
			return yield* Stream.runCollect(stream)
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	const last = results[results.length - 1]
	return { result: last?.result, isFailure: last?.isFailure ?? false }
}

const webSearchResult = async (
	search: (input: SearchInput) => Effect.Effect<SearchResult, ProviderError>,
	params: { query: string },
): Promise<{ result: unknown; isFailure: boolean }> => {
	const ports = Layer.mergeAll(
		Layer.succeed(SearchProvider)(SearchProvider.of({ search })),
		StubScrapeProvider,
		StubExtractProvider,
		StubRegistryEsProvider,
	)
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('web_search', params)
			return yield* Stream.runCollect(stream)
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	const last = results[results.length - 1]
	return { result: last?.result, isFailure: last?.isFailure ?? false }
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
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
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
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(
					Layer.provide(Layer.mergeAll(ports, testInfra)),
				),
			),
		),
	)
	if (captured === undefined) {
		throw new Error('scrape_page handler never called the scrape provider')
	}
	return captured
}

const discoverContactsInput = async (params: {
	company_name: string
	domain: string
	country?: string | null
}): Promise<DiscoverContactsInput> => {
	let captured: DiscoverContactsInput | undefined
	const infra = Layer.mergeAll(
		stubBudget,
		stubRunContext,
		Layer.succeed(ContactDiscovery)({
			discover: input => {
				captured = input
				return Effect.succeed({
					status: 'no_reliable_contact' as const,
					researchId: 'test-run',
				})
			},
		}),
		StubSearchProvider,
		StubScrapeProvider,
		StubExtractProvider,
		StubRegistryEsProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('discover_contacts', params)
			yield* Stream.runDrain(stream)
		}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(infra)))),
	)
	if (captured === undefined) {
		throw new Error('discover_contacts handler never called ContactDiscovery')
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

		describe('when the country is lowercase', () => {
			it('should upper-case it at the boundary before the router sees it', async () => {
				// GIVEN a model emitting a lowercase code
				// WHEN registry_lookup is handled
				const input = await registryLookupInput({ country: 'gb' })

				// THEN the router receives the normalized upper-case code
				expect(input.country).toBe('GB')
			})
		})

		describe('when the country has no national registry', () => {
			it('should hand back a no_registry result, not a tool error', async () => {
				// GIVEN a router that reports no registry for the country
				// WHEN registry_lookup is handled
				const result = await registryLookupResult(
					() => Effect.fail(new NoRegistry({ country: 'US' })),
					{ country: 'US' },
				)

				// THEN the model receives structured no_registry data pointing elsewhere
				expect(result).toEqual({
					status: 'no_registry',
					country: 'US',
					message: expect.stringContaining('discover_contacts'),
				})
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

describe('discover_contacts handler — delegates to the shared ContactDiscovery', () => {
	describe('when called with a company and domain', () => {
		it('should map the params and ride the run id + budget, not a new anchor', async () => {
			// GIVEN a discover_contacts tool call inside a run
			const input = await discoverContactsInput({
				company_name: 'Acme Corp',
				domain: 'acme.es',
				country: 'ES',
			})

			// THEN the params map onto the service input unchanged
			expect(input.companyName).toBe('Acme Corp')
			expect(input.domain).toBe('acme.es')
			expect(input.country).toBe('ES')
			// AND it reuses the run's id + budget rather than a standalone anchor
			expect(input.runContext?.researchId).toBe('test-run')
			expect(input.runContext?.budget).toBeDefined()
			expect(input.userId).toBeUndefined()
		})
	})

	describe('when country is explicit null', () => {
		it('should fold it to undefined, like the other tools', async () => {
			// GIVEN a model that sent null for the country hint
			const input = await discoverContactsInput({
				company_name: 'Acme Corp',
				domain: 'acme.es',
				country: null,
			})

			// THEN the null folds to "not provided"
			expect(input.country).toBeUndefined()
		})
	})
})

describe('researchToolkit — a web-fetch failure is non-fatal', () => {
	describe('scrape_page handler', () => {
		describe('when the scrape provider fails with a ProviderError', () => {
			it('should surface the failure to the model instead of aborting the run', async () => {
				// GIVEN a scrape provider that rejects the page with a 401
				const { isFailure } = await scrapePageResult(
					() =>
						Effect.fail(
							new ProviderError({
								provider: 'firecrawl',
								message: 'scrape failed: HTTP 401',
								recoverable: false,
							}),
						),
					{ url: 'https://dead.example' },
				)

				// THEN handling completes and the last result is a failure the model
				// can read — the fiber running generateText is never killed
				expect(isFailure).toBe(true)
			})
		})
	})

	describe('web_search handler', () => {
		describe('when the search provider fails with a ProviderError', () => {
			it('should surface the failure to the model instead of aborting the run', async () => {
				// GIVEN a search provider that returns a 422
				const { isFailure } = await webSearchResult(
					() =>
						Effect.fail(
							new ProviderError({
								provider: 'brave',
								message: 'search failed: HTTP 422',
								recoverable: false,
							}),
						),
					{ query: 'acme corp' },
				)

				// THEN the model receives a failure result and the run continues
				expect(isFailure).toBe(true)
			})
		})
	})

	describe('extract_structured handler', () => {
		describe('when the extract provider fails with a forbidden ProviderError', () => {
			it('should surface the failure to the model instead of aborting the run', async () => {
				// GIVEN an extract provider that rejects the page with a 403 (forbidden)
				const { isFailure } = await extractStructuredResult(
					() =>
						Effect.fail(
							new ProviderError({
								provider: 'firecrawl',
								message: 'extract failed: HTTP 403',
								recoverable: false,
							}),
						),
					{ url: 'https://acmecorp.es', schema_name: 'freeform' },
				)

				// THEN the model reads the failure and moves on — the generateText
				// fiber is not killed, so one forbidden page can't sink the whole run
				expect(isFailure).toBe(true)
			})
		})
	})
})
