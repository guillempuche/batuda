import { Effect, Layer, Logger, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	BudgetExceeded,
	MonthlyCapExceeded,
	NoRegistry,
	ProviderError,
	UnsupportedSite,
} from '../domain/errors'
import { RegistryRecord, ScrapedPage, SearchResult } from '../domain/types'
import { StubRegistryEsProvider } from '../infrastructure/stub/registry-es'
import { StubScrapeProvider } from '../infrastructure/stub/scrape'
import { StubSearchProvider } from '../infrastructure/stub/search'
import {
	ContactDiscovery,
	type DiscoverContactsInput,
} from './contact-discovery'
import type { EntityTargets } from './entity-guard'
import {
	Budget,
	type RegistryInput,
	RegistryRouter,
	ResearchRunContext,
	type ScrapeInput,
	ScrapeProvider,
	type SearchInput,
	SearchProvider,
} from './ports'
import {
	isUnsupportedScrapeUrl,
	RegistryLookupTool,
	researchToolkit,
	researchToolkitLayer,
	researchToolkitWireFormat,
	ScrapePageTool,
	scrapeSkipResult,
	stripPlaceholderSiteFilters,
	WebSearchTool,
} from './tools'

// Budget + run context the toolkit handlers now require. These tests exercise
// param mapping, not spend, so the charges are no-ops and the snapshot is
// generous enough that nothing is ever refused.
const stubBudget = Layer.succeed(Budget)(
	Budget.of({
		chargeCheap: () => Effect.void,
		chargePaid: () => Effect.succeed(true),
		withPaidCharge: () => call =>
			Effect.map(Effect.suspend(call), value => ({
				_tag: 'bought' as const,
				value,
			})),
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
	country?: string | null
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
		StubRegistryEsProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('web_search', {
				limit: null,
				recency_days: null,
				country: null,
				...params,
			})
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

// Drive web_search under a run context that targets a specific company, so the
// captured query reveals whether the handler re-anchored it to that company
// before the query reached the provider.
const webSearchInputForTarget = async (
	params: { query: string },
	target: {
		entityTargets: EntityTargets | null
		entityName?: string | undefined
	},
): Promise<SearchInput> => {
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
		StubRegistryEsProvider,
	)
	const infra = Layer.mergeAll(
		stubBudget,
		Layer.succeed(ResearchRunContext)({ researchId: 'test-run', ...target }),
		Layer.succeed(ContactDiscovery)({
			discover: () =>
				Effect.succeed({
					status: 'no_reliable_contact' as const,
					researchId: 'test-run',
				}),
		}),
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('web_search', {
				limit: null,
				recency_days: null,
				country: null,
				...params,
			})
			yield* Stream.runDrain(stream)
		}).pipe(
			Effect.provide(
				researchToolkitLayer.pipe(Layer.provide(Layer.mergeAll(ports, infra))),
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
						new RegistryRecord({
							legalName: 'ACME',
							sourceUrl:
								'https://find-and-update.company-information.service.gov.uk/company/ACME',
							units: 0,
						}),
					)
				},
			}),
		),
		StubSearchProvider,
		StubScrapeProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('registry_lookup', {
				query: null,
				tax_id: null,
				...params,
			})
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

// Drive registry_lookup with a custom router and return the tool's final stream
// element — asserts what the model receives (its value and whether it is a
// failure), not what the router was handed.
const registryLookupResult = async (
	lookup: (
		input: RegistryInput,
	) => Effect.Effect<RegistryRecord, ProviderError | NoRegistry>,
	params: { country: string; query?: string | null; tax_id?: string | null },
): Promise<{ result: unknown; isFailure: boolean }> => {
	const ports = Layer.mergeAll(
		Layer.succeed(RegistryRouter)(RegistryRouter.of({ lookup })),
		StubSearchProvider,
		StubScrapeProvider,
	)
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('registry_lookup', {
				query: null,
				tax_id: null,
				...params,
			})
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

// Drive a web-fetch tool with a failing provider and return the final stream
// element, so a test can assert the model saw a failure (isFailure) rather than
// the run fiber being aborted.
const scrapePageResult = async (
	scrape: (
		input: ScrapeInput,
	) => Effect.Effect<ScrapedPage, ProviderError | UnsupportedSite>,
	params: { url: string },
): Promise<{ result: unknown; isFailure: boolean }> => {
	const ports = Layer.mergeAll(
		Layer.succeed(ScrapeProvider)(ScrapeProvider.of({ scrape })),
		StubSearchProvider,
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

const webSearchResult = async (
	search: (input: SearchInput) => Effect.Effect<SearchResult, ProviderError>,
	params: { query: string },
): Promise<{ result: unknown; isFailure: boolean }> => {
	const ports = Layer.mergeAll(
		Layer.succeed(SearchProvider)(SearchProvider.of({ search })),
		StubScrapeProvider,
		StubRegistryEsProvider,
	)
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('web_search', {
				limit: null,
				recency_days: null,
				country: null,
				...params,
			})
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
		StubRegistryEsProvider,
	)
	await Effect.runPromise(
		Effect.gen(function* () {
			const toolkit = yield* researchToolkit
			const stream = yield* toolkit.handle('discover_contacts', {
				country: null,
				...params,
			})
			yield* Stream.runDrain(stream)
		}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(infra)))),
	)
	if (captured === undefined) {
		throw new Error('discover_contacts handler never called ContactDiscovery')
	}
	return captured
}

describe('researchToolkit web_search — a drifted query is re-anchored to the run target', () => {
	const acme: EntityTargets = {
		cores: ['acmelogistics'],
		words: ['acme'],
		domains: ['acme.com'],
		places: [],
	}

	describe('when the run targets a company and the query dropped its name', () => {
		it('should prepend the company name before the query reaches the provider', async () => {
			// GIVEN a run whose target is Acme and a query naming neither it nor its domain
			// WHEN the web_search handler runs
			// THEN the provider is called with the query re-anchored to the target
			const input = await webSearchInputForTarget(
				{ query: 'number of employees' },
				{ entityTargets: acme, entityName: 'Acme Logistics' },
			)
			expect(input.query).toBe('"Acme Logistics" number of employees')
		})
	})

	describe('when the query already names the company', () => {
		it('should pass the query through unchanged', async () => {
			// GIVEN a query that already reaches the target (a strong name match)
			// WHEN the handler runs
			// THEN it is sent as-is — re-anchoring would only narrow an on-target query
			const input = await webSearchInputForTarget(
				{ query: 'Acme Logistics headquarters city' },
				{ entityTargets: acme, entityName: 'Acme Logistics' },
			)
			expect(input.query).toBe('Acme Logistics headquarters city')
		})
	})

	describe('when the run has no single target company', () => {
		it('should pass the query through unchanged', async () => {
			// GIVEN a scan/freeform run (no entity targets) that legitimately searches
			// for third parties
			// WHEN the handler runs
			// THEN the query is never narrowed to a name
			const input = await webSearchInputForTarget(
				{ query: 'top metal fabrication shops in Ohio' },
				{ entityTargets: null, entityName: 'Acme Logistics' },
			)
			expect(input.query).toBe('top metal fabrication shops in Ohio')
		})
	})
})

describe('researchToolkit tool params — null and quoted numbers are read, not refused', () => {
	describe('web_search handler', () => {
		describe('when the optional params are explicit null', () => {
			it('should hand the search provider undefined for limit, recency, and location', async () => {
				// GIVEN a model that emits null for every optional field it is not using
				// WHEN the web_search tool call is handled
				const input = await webSearchInput({
					query: 'acme corp',
					limit: null,
					recency_days: null,
					country: null,
				})

				// THEN the required query still arrives
				expect(input.query).toBe('acme corp')
				// AND each optional null is folded to "not provided"
				expect(input.limit).toBeUndefined()
				expect(input.recency).toBeUndefined()
				expect(input.country).toBeUndefined()
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
					country: 'ES',
				})

				// THEN the values reach the provider unchanged, recency as a { days } object
				expect(input.limit).toBe(5)
				expect(input.recency).toEqual({ days: 7 })
				expect(input.country).toBe('ES')
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
				expect(input.country).toBeUndefined()
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
				const input = await webSearchInput({ query: 'acme corp', country: '' })

				// THEN the empty string is a real value and is preserved
				expect(input.country).toBe('')
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
				const { result } = await registryLookupResult(
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

		describe('when the register is unreachable or out of credit', () => {
			it('should return the failure to the model instead of aborting the run', async () => {
				// GIVEN the shape an unfunded register takes — a 402 mapped to a
				// non-recoverable provider failure
				// WHEN registry_lookup is handled
				const { isFailure } = await registryLookupResult(
					() =>
						Effect.fail(
							new ProviderError({
								provider: 'librebor',
								message: 'registry lookup failed: HTTP 402',
								recoverable: false,
							}),
						),
					{ country: 'ES' },
				)

				// THEN the model sees the failure and the run carries on, rather than the
				// whole pass being torn down over one lookup it can skip
				expect(isFailure).toBe(true)
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
		describe('when a nullable param is explicit null', () => {
			it('should decode without rejecting for every nullable param', () => {
				// GIVEN the raw args a model sends with null for the params it is not
				// using — the exact decode that threw "Expected number, got null" before
				// the fix. The params are required + nullable, so a real model always
				// sends every one.
				// WHEN each tool schema decodes them
				// THEN the null passes through instead of failing validation
				// [Schema.NullOr(...)]
				const web = Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
					query: 'acme',
					limit: null,
					recency_days: null,
					country: null,
				})
				expect(web.limit).toBeNull()
				expect(web.recency_days).toBeNull()
				expect(web.country).toBeNull()

				const registry = Schema.decodeUnknownSync(
					RegistryLookupTool.parametersSchema,
				)({ country: 'ES', query: null, tax_id: null })
				expect(registry.query).toBeNull()
				expect(registry.tax_id).toBeNull()
			})
		})

		describe('when the model writes a number as text', () => {
			it('should read a quoted number back as the number', () => {
				// GIVEN a model that quoted its numbers — the arguments a real run died on
				const params = Schema.decodeUnknownSync(WebSearchTool.parametersSchema)(
					{
						query: 'acme',
						limit: '10',
						recency_days: '7',
						country: null,
					},
				)

				// THEN each is read back as the number it names
				expect(params.limit).toBe(10)
				expect(params.recency_days).toBe(7)
			})

			it('should keep a quoted zero, which is a real value and not "none"', () => {
				// GIVEN "0" — easy to mistake for "nothing", but a real answer: today only
				const params = Schema.decodeUnknownSync(WebSearchTool.parametersSchema)(
					{
						query: 'acme',
						limit: null,
						recency_days: '0',
						country: null,
					},
				)

				// THEN it survives as 0 rather than being folded into "not provided"
				expect(params.recency_days).toBe(0)
			})

			it('should treat text naming no number as no value, not as an error', () => {
				// GIVEN words and a blank where a number was asked for
				const params = Schema.decodeUnknownSync(WebSearchTool.parametersSchema)(
					{
						query: 'acme',
						limit: 'ten',
						recency_days: '',
						country: null,
					},
				)

				// THEN the search simply runs without them — one unreadable argument
				// must never cost the run
				expect(params.limit).toBeNull()
				expect(params.recency_days).toBeNull()
			})
		})

		describe('when a numeric param is neither a number nor text', () => {
			it('should still reject — accepting text is not accepting anything', () => {
				// GIVEN a boolean and an array where a number is expected
				expect(() =>
					Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
						query: 'acme',
						limit: true,
						recency_days: null,
						country: null,
					}),
				).toThrow()
				expect(() =>
					Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
						query: 'acme',
						limit: null,
						recency_days: [],
						country: null,
					}),
				).toThrow()
			})
		})

		describe('when a non-nullable field is null', () => {
			it('should reject — only the optional params accept null', () => {
				// GIVEN null for a field that is required and not nullable (query, url)
				// THEN decode fails, because those fields stay bare String
				expect(() =>
					Schema.decodeUnknownSync(WebSearchTool.parametersSchema)({
						query: null,
						limit: null,
						recency_days: null,
						country: null,
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

			it('should carry the provider error message into the model-facing result', async () => {
				// GIVEN a scrape whose cache layer rejects the page with a classified
				//   provider:'cache' failure that names the offending row
				const { result, isFailure } = await scrapePageResult(
					() =>
						Effect.fail(
							new ProviderError({
								provider: 'cache',
								message: 'sources row src_deadbeef has no content_ref',
								recoverable: false,
							}),
						),
					{ url: 'https://warm.example' },
				)

				// THEN the model reads a failure whose description surfaces that exact
				//   message — not a {provider,recoverable,_tag} dump that drops the
				//   non-enumerable Error.message — so the failing line is named in the
				//   run's tool log
				expect(isFailure).toBe(true)
				const description = (result as { reason: { description: string } })
					.reason.description
				expect(description).toBe(
					'scrape_page: sources row src_deadbeef has no content_ref',
				)
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
})

describe('researchToolkit scrape_page — an unsupported site is skipped, not failed', () => {
	describe('when the url is a known people directory (LinkedIn)', () => {
		it('should return a discover_contacts skip result without ever calling the scrape provider', async () => {
			// GIVEN a scrape provider that would fail loudly if it were ever reached
			let called = false
			const { result, isFailure } = await scrapePageResult(
				() => {
					called = true
					return Effect.fail(
						new ProviderError({
							provider: 'firecrawl',
							message: 'should not be called',
							recoverable: false,
						}),
					)
				},
				{ url: 'https://www.linkedin.com/company/echo-global-logistics' },
			)

			// THEN the provider is never invoked (no scrape spent) and the model
			// reads a non-failure skip that routes people lookups to discover_contacts
			expect(called).toBe(false)
			expect(isFailure).toBe(false)
			expect(result).toEqual(
				scrapeSkipResult(
					'https://www.linkedin.com/company/echo-global-logistics',
				),
			)
		})
	})

	describe('when the provider refuses the site with UnsupportedSite', () => {
		it('should map the refusal to a non-failure skip so the run keeps going', async () => {
			// GIVEN a scrape provider that reports the site is unsupported (the 403 no
			// key or retry can fix)
			const { result, isFailure } = await scrapePageResult(
				() =>
					Effect.fail(
						new UnsupportedSite({
							provider: 'firecrawl',
							url: 'https://directory.example/profile',
						}),
					),
				{ url: 'https://directory.example/profile' },
			)

			// THEN the model receives a skip result rather than a failure it can't act on
			expect(isFailure).toBe(false)
			expect(result).toEqual(
				scrapeSkipResult('https://directory.example/profile'),
			)
		})
	})
})

describe('isUnsupportedScrapeUrl', () => {
	describe('when the url is a LinkedIn page or subdomain', () => {
		it('should flag the apex, www, a country subdomain, and a company path', () => {
			// GIVEN LinkedIn urls the loop must never scrape
			// THEN each is recognised regardless of subdomain or path
			expect(isUnsupportedScrapeUrl('https://linkedin.com')).toBe(true)
			expect(isUnsupportedScrapeUrl('https://www.linkedin.com/in/jane')).toBe(
				true,
			)
			expect(
				isUnsupportedScrapeUrl('https://es.linkedin.com/company/acme'),
			).toBe(true)
		})
	})

	describe('when the url is a normal company site', () => {
		it('should not flag a homepage, and must not match a look-alike host', () => {
			// GIVEN a real company site and a host that merely contains the word
			// THEN neither is treated as unsupported — only the real registrable host is
			expect(isUnsupportedScrapeUrl('https://www.echo.com')).toBe(false)
			expect(isUnsupportedScrapeUrl('https://sunsettrans.com/about')).toBe(
				false,
			)
			expect(isUnsupportedScrapeUrl('https://notlinkedin.com')).toBe(false)
			expect(isUnsupportedScrapeUrl('https://linkedin.com.evil.example')).toBe(
				false,
			)
		})
	})

	describe('when the url is unparseable', () => {
		it('should return false rather than throw', () => {
			// GIVEN a value that is not a url
			// THEN classification is a safe false
			expect(isUnsupportedScrapeUrl('not a url')).toBe(false)
			expect(isUnsupportedScrapeUrl('')).toBe(false)
		})
	})
})

describe('scrapeSkipResult', () => {
	describe('when building the model-facing skip', () => {
		it('should carry the url, the unsupported_site reason, and a discover_contacts pointer', () => {
			// GIVEN a url the loop skipped
			const result = scrapeSkipResult('https://www.linkedin.com/company/acme')

			// THEN the shape is a non-failure status that names the reason and the
			// next tool to use
			expect(result.status).toBe('skipped')
			expect(result.reason).toBe('unsupported_site')
			expect(result.url).toBe('https://www.linkedin.com/company/acme')
			expect(result.message).toContain('discover_contacts')
		})
	})
})

describe('stripPlaceholderSiteFilters', () => {
	describe('when real keywords carry a placeholder site: filter', () => {
		it('should drop the filter and keep the keywords', () => {
			// GIVEN a query with a made-up site:example.com filter
			const query = 'midsize US 3PL freight brokerage site:example.com'

			// WHEN the placeholder filter is stripped
			const result = stripPlaceholderSiteFilters(query)

			// THEN only the real keywords remain, with no double spaces
			expect(result).toBe('midsize US 3PL freight brokerage')
		})
	})

	describe('when the placeholder uses a non-.com or family host', () => {
		it('should strip example.org, yourdomain.*, domain.*, and placeholder.*', () => {
			// GIVEN queries with each recognised placeholder family
			// WHEN each is stripped
			// THEN the placeholder token is removed
			expect(stripPlaceholderSiteFilters('freight site:example.org')).toBe(
				'freight',
			)
			expect(stripPlaceholderSiteFilters('freight site:yourdomain.com')).toBe(
				'freight',
			)
			expect(stripPlaceholderSiteFilters('freight site:domain.net')).toBe(
				'freight',
			)
			expect(stripPlaceholderSiteFilters('freight site:placeholder.io')).toBe(
				'freight',
			)
		})
	})

	describe('when the placeholder host has trailing punctuation', () => {
		it('should still recognise and strip it', () => {
			// GIVEN a site: filter followed by a comma
			const query = 'brokers site:example.com, midsize'

			// WHEN stripped
			const result = stripPlaceholderSiteFilters(query)

			// THEN the placeholder is gone and the rest is kept
			expect(result).toBe('brokers midsize')
		})
	})

	describe('when the site: filter targets a real domain', () => {
		it('should keep it untouched', () => {
			// GIVEN a query filtering by a real, known domain
			const query = 'ocado directors site:gov.uk'

			// WHEN stripped
			const result = stripPlaceholderSiteFilters(query)

			// THEN the real filter is preserved
			expect(result).toBe('ocado directors site:gov.uk')
		})
	})

	describe('when there is no site: filter at all', () => {
		it('should return the query unchanged', () => {
			// GIVEN a plain keyword query
			const query = 'midsize US freight brokerage companies'

			// WHEN stripped
			const result = stripPlaceholderSiteFilters(query)

			// THEN it is returned as-is
			expect(result).toBe(query)
		})
	})

	describe('when the query is only a placeholder site: filter', () => {
		it('should keep the original so the search still runs', () => {
			// GIVEN a query that is nothing but the placeholder filter
			const query = 'site:example.com'

			// WHEN stripping would leave an empty query
			const result = stripPlaceholderSiteFilters(query)

			// THEN the original is preserved rather than searching for nothing
			expect(result).toBe('site:example.com')
		})
	})
})

describe('researchToolkitWireFormat', () => {
	describe('when serialising the toolkit for a provider', () => {
		it('should carry every research tool in the shape sent to a provider', () => {
			// GIVEN the real toolkit
			const tools = researchToolkitWireFormat()

			// WHEN written out for the wire
			const names = tools.map(
				tool => (tool['function'] as { name: string }).name,
			)

			// THEN every tool is present, nested under `function` the way the
			// chat-completions API expects
			expect(names.sort()).toEqual([
				'discover_contacts',
				'registry_lookup',
				'scrape_page',
				'web_search',
			])
			for (const tool of tools) {
				expect(tool['type']).toBe('function')
			}
		})

		it('should mark every tool strict so a provider checks the schema', () => {
			// GIVEN the real toolkit
			const tools = researchToolkitWireFormat()

			// WHEN written out — THEN each tool opts into strict validation, so a
			// probe reproduces the request a run actually makes
			for (const tool of tools) {
				expect((tool['function'] as { strict: boolean }).strict).toBe(true)
			}
		})

		it("should carry each tool's real parameters and description, not a stand-in", () => {
			// GIVEN the real toolkit
			const tools = researchToolkitWireFormat()

			// WHEN the search tool is read back
			const search = tools.find(
				tool => (tool['function'] as { name: string }).name === 'web_search',
			)?.['function'] as {
				description: string
				parameters: { properties: Record<string, unknown>; type: string }
			}

			// THEN it carries web_search's own arguments — the probe is asking about
			// the tools we ship, not a simplified copy
			expect(search.description).toContain('Search the public web')
			expect(search.parameters.type).toBe('object')
			expect(Object.keys(search.parameters.properties).sort()).toEqual([
				'country',
				'limit',
				'query',
				'recency_days',
			])
		})
	})
})

describe('what a tool call charges the run', () => {
	// A run decides whether it can keep going from a flat, predictable figure
	// charged before each call. Providers bill unevenly — one Firecrawl search
	// can consume several credits — so what a call really cost is recorded
	// separately and must never reach this decision: a run's reach would then
	// swing with a vendor's pricing.
	const chargingToolkit = (charged: Array<readonly [string, number]>) => {
		const budget = Layer.succeed(Budget)(
			Budget.of({
				chargeCheap: (provider, cents) =>
					Effect.sync(() => {
						charged.push([provider, cents])
					}),
				chargePaid: () => Effect.succeed(true),
				withPaidCharge: () => call =>
					Effect.map(Effect.suspend(call), value => ({
						_tag: 'bought' as const,
						value,
					})),
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
		// A provider that reports a hefty real cost for one call.
		const expensiveSearch = Layer.succeed(SearchProvider)(
			SearchProvider.of({
				search: () => Effect.succeed(new SearchResult({ items: [], units: 7 })),
			}),
		)
		return researchToolkitLayer.pipe(
			Layer.provide(
				Layer.mergeAll(
					budget,
					stubRunContext,
					expensiveSearch,
					StubScrapeProvider,
					StubRegistryEsProvider,
					Layer.succeed(ContactDiscovery)({
						discover: () =>
							Effect.succeed({
								status: 'no_reliable_contact' as const,
								researchId: 'test-run',
							}),
					}),
				),
			),
		)
	}

	describe('when the provider reports a call cost several credits', () => {
		it('should still charge the flat figure the run plans against', async () => {
			// GIVEN a search whose provider reports seven credits for one call
			const charged: Array<readonly [string, number]> = []

			// WHEN the tool runs
			await Effect.runPromise(
				Effect.gen(function* () {
					const toolkit = yield* researchToolkit
					const stream = yield* toolkit.handle('web_search', {
						query: 'acme',
						limit: null,
						recency_days: null,
						country: null,
					})
					yield* Stream.runDrain(stream)
				}).pipe(Effect.provide(chargingToolkit(charged)), Effect.orDie),
			)

			// THEN one flat charge is made, not seven — a run gets the same number
			// of searches whatever a vendor happens to bill
			expect(charged).toEqual([['search', 1]])
		})
	})
})

describe('looking the same company up twice in one run', () => {
	// The national register charges per lookup, so the second identical lookup
	// must never reach it. The budget answers whether this call was the one that
	// paid; here the second charge reports that it was not.
	it('should answer from what the run already bought, without asking again', async () => {
		// GIVEN a run that has already paid for this lookup, and a register that
		// records every time it is asked
		let asked = 0
		const paidOnce = Layer.succeed(Budget)(
			Budget.of({
				chargeCheap: () => Effect.void,
				chargePaid: () => Effect.succeed(false),
				// Already paid for in this run, so the vendor is never called.
				withPaidCharge: () => () =>
					Effect.succeed({ _tag: 'already_charged' as const }),
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
		const ports = Layer.mergeAll(
			Layer.succeed(RegistryRouter)(
				RegistryRouter.of({
					lookup: () => {
						asked++
						return Effect.succeed(
							new RegistryRecord({
								legalName: 'Acme SL',
								sourceUrl: 'https://registry.example/acme',
								units: 0,
							}),
						)
					},
				}),
			),
			StubSearchProvider,
			StubScrapeProvider,
			paidOnce,
			stubRunContext,
			Layer.succeed(ContactDiscovery)({
				discover: () =>
					Effect.succeed({
						status: 'no_reliable_contact' as const,
						researchId: 'test-run',
					}),
			}),
		)

		// WHEN the tool runs
		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const toolkit = yield* researchToolkit
				const stream = yield* toolkit.handle('registry_lookup', {
					country: 'ES',
					query: 'Acme SL',
					tax_id: null,
				})
				return yield* Stream.runCollect(stream)
			}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports)))),
		)

		// THEN the register is never asked, and the model is told the answer is
		// already in its transcript rather than being handed a failure
		expect(asked).toBe(0)
		expect(JSON.stringify(results[results.length - 1])).toContain(
			'already_looked_up',
		)
	})
})

describe('looking up a country Batuda has no register for', () => {
	// The register costs real money per lookup. A country with no adapter has
	// nothing to look up in, so finding that out must not be something the run
	// pays for.
	it('should say so without charging for the answer', async () => {
		// GIVEN a budget that records every paid charge, and a register that
		// records every time it is asked
		const charged: string[] = []
		let asked = 0
		const countingBudget = Layer.succeed(Budget)(
			Budget.of({
				chargeCheap: () => Effect.void,
				chargePaid: provider =>
					Effect.sync(() => {
						charged.push(provider)
						return true
					}),
				withPaidCharge: provider => call =>
					Effect.gen(function* () {
						charged.push(provider)
						return {
							_tag: 'bought' as const,
							value: yield* Effect.suspend(call),
						}
					}),
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
		const ports = Layer.mergeAll(
			Layer.succeed(RegistryRouter)(
				RegistryRouter.of({
					lookup: () => {
						asked++
						return Effect.die('a country with no register must not be asked')
					},
				}),
			),
			StubSearchProvider,
			StubScrapeProvider,
			countingBudget,
			stubRunContext,
			Layer.succeed(ContactDiscovery)({
				discover: () =>
					Effect.succeed({
						status: 'no_reliable_contact' as const,
						researchId: 'test-run',
					}),
			}),
		)

		// WHEN the tool is asked about a country with no national register
		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const toolkit = yield* researchToolkit
				const stream = yield* toolkit.handle('registry_lookup', {
					country: 'NL',
					query: 'Acme BV',
					tax_id: null,
				})
				return yield* Stream.runCollect(stream)
			}).pipe(Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports)))),
		)

		// THEN nothing was charged and nothing was asked — the model is simply
		// told there is no register, so it can move on to another way
		expect(charged).toEqual([])
		expect(asked).toBe(0)
		expect(JSON.stringify(results[results.length - 1])).toContain('no_registry')
	})
})

describe('a run that spends its budget', () => {
	// Running out of budget is how a run is meant to stop, so it must be reported
	// as the ordinary stop it is: at warning, and with the tool named once. Catch
	// it as an expected stop and then again as a failure and the telemetry fills
	// with errors for something normal, while the model reads
	// "web_search: web_search: cheap budget exhausted".

	// Every log line written while a tool runs, so what was recorded — and at what
	// level — can be asserted rather than inferred.
	const capturedLogs = (
		lines: Array<{ level: string; message: string }>,
	): Layer.Layer<never> =>
		Logger.layer([
			Logger.make(options => {
				lines.push({
					level: String(options.logLevel),
					message: String(options.message),
				})
			}),
		])

	// A budget with nothing left in either tier, so any tool that charges before
	// calling its vendor is refused.
	const spentBudget = (remaining: number) =>
		Layer.succeed(Budget)(
			Budget.of({
				chargeCheap: (_provider, cents) =>
					Effect.fail(
						new BudgetExceeded({
							tier: 'cheap',
							needed: cents,
							remaining,
						}),
					),
				chargePaid: () => Effect.succeed(true),
				withPaidCharge: (_provider, cents) => () =>
					Effect.fail(
						new BudgetExceeded({
							tier: 'paid-run',
							needed: cents,
							remaining,
						}),
					),
				snapshot: () =>
					Effect.succeed({
						cheapBudget: 1000,
						cheapSpent: 1000 - remaining,
						cheapRemaining: remaining,
						paidBudget: 1000,
						paidSpent: 1000 - remaining,
						paidRemaining: remaining,
					}),
			}),
		)

	// Drive one tool against a spent budget and report both what the model was
	// handed and everything that was logged on the way.
	const exhausted = async (
		tool: 'web_search' | 'scrape_page' | 'registry_lookup',
		params: Record<string, unknown>,
		budget: Layer.Layer<Budget> = spentBudget(7),
	): Promise<{
		description: string
		isFailure: boolean
		logs: ReadonlyArray<{ level: string; message: string }>
	}> => {
		const logs: Array<{ level: string; message: string }> = []
		const ports = Layer.mergeAll(
			StubSearchProvider,
			StubScrapeProvider,
			StubRegistryEsProvider,
			budget,
			stubRunContext,
			Layer.succeed(ContactDiscovery)({
				discover: () =>
					Effect.succeed({
						status: 'no_reliable_contact' as const,
						researchId: 'test-run',
					}),
			}),
		)
		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const toolkit = yield* researchToolkit
				const stream = yield* toolkit.handle(tool, params as never)
				return yield* Stream.runCollect(stream)
			}).pipe(
				Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports))),
				Effect.provide(capturedLogs(logs)),
			),
		)
		const last = results[results.length - 1]
		return {
			description: (last?.result as { reason?: { description?: string } })
				?.reason?.description as string,
			isFailure: last?.isFailure ?? false,
			logs,
		}
	}

	describe('when the cheap budget refuses a search', () => {
		it('should tell the model to stop, naming the tool once', async () => {
			// GIVEN a run with 7¢ of cheap budget left and a search to make
			const { description, isFailure } = await exhausted('web_search', {
				query: 'acme corp',
				limit: null,
				recency_days: null,
				country: null,
			})

			// THEN the model reads one tool name in front of one sentence
			expect(isFailure).toBe(true)
			expect(description).toBe(
				'web_search: cheap budget exhausted (7¢ left) — stop searching and summarize what you have',
			)
		})

		it('should record the stop at warning and not as a failure', async () => {
			// GIVEN the same refused search
			const { logs } = await exhausted('web_search', {
				query: 'acme corp',
				limit: null,
				recency_days: null,
				country: null,
			})

			// THEN it is logged once, at warning — an investigation into error-level
			// tool failures never has to sift ordinary budget stops out of them
			expect(logs).toContainEqual({
				level: 'Warn',
				message: 'research.tool.budget_exhausted',
			})
			expect(
				logs.filter(line => line.message.includes('research.tool.failed')),
			).toEqual([])
		})
	})

	describe('when the cheap budget refuses a page fetch', () => {
		it('should report it the same way it reports a refused search', async () => {
			// GIVEN a run with 7¢ left and a page to fetch
			const { description, isFailure, logs } = await exhausted('scrape_page', {
				url: 'https://acme.example',
			})

			// THEN the message names scrape_page once and the stop is a warning
			expect(isFailure).toBe(true)
			expect(description).toBe(
				'scrape_page: cheap budget exhausted (7¢ left) — stop searching and summarize what you have',
			)
			expect(logs).toContainEqual({
				level: 'Warn',
				message: 'research.tool.budget_exhausted',
			})
			expect(
				logs.filter(line => line.message.includes('research.tool.failed')),
			).toEqual([])
		})
	})

	describe('when the paid budget refuses a register lookup', () => {
		it('should name the tool once', async () => {
			// GIVEN a run whose paid tier has 7¢ left and a register to ask
			const { description, isFailure } = await exhausted('registry_lookup', {
				country: 'ES',
				query: 'Acme SL',
				tax_id: null,
			})

			// THEN the model reads the tool's name once, as it does on the cheap tier
			expect(isFailure).toBe(true)
			expect(description).toBe(
				'registry_lookup: paid budget exhausted (7¢ left) — stop using registry_lookup',
			)
		})
	})

	describe('when the month’s paid cap is reached', () => {
		it('should name the tool once', async () => {
			// GIVEN an organization that has spent its whole monthly paid allowance
			const cappedBudget = Layer.succeed(Budget)(
				Budget.of({
					chargeCheap: () => Effect.void,
					chargePaid: () => Effect.succeed(true),
					withPaidCharge: () => () =>
						Effect.fail(
							new MonthlyCapExceeded({ capCents: 5000, spentCents: 5000 }),
						),
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
			const { description, isFailure } = await exhausted(
				'registry_lookup',
				{ country: 'ES', query: 'Acme SL', tax_id: null },
				cappedBudget,
			)

			// THEN the cap is reported like every other stop: one tool name
			expect(isFailure).toBe(true)
			expect(description).toBe(
				'registry_lookup: monthly paid cap reached (5000/5000¢) — stop using registry_lookup',
			)
		})
	})

	describe('when a vendor genuinely fails', () => {
		it('should still be logged as a failure, named once', async () => {
			// GIVEN a search provider that returns a 422 while the budget is healthy
			const logs: Array<{ level: string; message: string }> = []
			const ports = Layer.mergeAll(
				Layer.succeed(SearchProvider)(
					SearchProvider.of({
						search: () =>
							Effect.fail(
								new ProviderError({
									provider: 'brave',
									message: 'search failed: HTTP 422',
									recoverable: false,
								}),
							),
					}),
				),
				StubScrapeProvider,
				StubRegistryEsProvider,
				testInfra,
			)
			const results = await Effect.runPromise(
				Effect.gen(function* () {
					const toolkit = yield* researchToolkit
					const stream = yield* toolkit.handle('web_search', {
						query: 'acme corp',
						limit: null,
						recency_days: null,
						country: null,
					})
					return yield* Stream.runCollect(stream)
				}).pipe(
					Effect.provide(researchToolkitLayer.pipe(Layer.provide(ports))),
					Effect.provide(capturedLogs(logs)),
				),
			)

			// THEN letting the budget stop past the failure logger has not made it
			// blind to a real failure, and the message still names the tool once
			const last = results[results.length - 1]
			expect(last?.isFailure).toBe(true)
			expect(
				(last?.result as { reason?: { description?: string } })?.reason
					?.description,
			).toBe('web_search: search failed: HTTP 422')
			expect(logs).toContainEqual({
				level: 'Error',
				message: 'research.tool.failed',
			})
		})
	})
})
