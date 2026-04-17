/**
 * Stub search provider — returns deterministic fake data for local development.
 *
 * Exports both the instance (for the provider factory table in
 * `providers-live.ts`) and the standalone Layer (single-slot callers, tests).
 */

import { Effect, Layer } from 'effect'

import { SearchProvider } from '../../application/ports'
import { SearchResult, SearchResultItem } from '../../domain/types'

export const StubSearchProviderInstance = SearchProvider.of({
	search: _input =>
		Effect.succeed(
			new SearchResult({
				items: [
					new SearchResultItem({
						url: 'https://acmecorp.es',
						title: 'Acme Corp S.L. — Soluciones industriales en Barcelona',
						snippet:
							'Acme Corp S.L. es una empresa líder en soluciones industriales con sede en Barcelona, fundada en 2005.',
					}),
					new SearchResultItem({
						url: 'https://linkedin.com/company/acme-corp-sl',
						title: 'Acme Corp S.L. | LinkedIn',
						snippet:
							'Acme Corp S.L. | 150 followers on LinkedIn. Industrial solutions provider based in Barcelona, Spain.',
					}),
					new SearchResultItem({
						url: 'https://news.example.com/acme-expansion',
						title: 'Acme Corp S.L. announces Mediterranean expansion',
						snippet:
							'Barcelona-based Acme Corp S.L. (CIF B12345678) plans to expand operations across the Mediterranean region in 2026.',
					}),
				],
				units: 0,
			}),
		),
})

export const StubSearchProvider = Layer.succeed(SearchProvider)(
	StubSearchProviderInstance,
)
