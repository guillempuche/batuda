/**
 * Stub scrape provider — returns deterministic fake markdown for local development.
 *
 * Exports both the instance (for the provider factory table in
 * `providers-live.ts`) and the standalone Layer (single-slot callers, tests).
 */

import { Effect, Layer } from 'effect'

import { ScrapeProvider } from '../../application/ports'
import { ScrapedPage } from '../../domain/types'

export const StubScrapeProviderInstance = ScrapeProvider.of({
	scrape: input =>
		Effect.succeed(
			new ScrapedPage({
				url: input.url,
				markdown: [
					'# Acme Corp S.L.',
					'',
					'**Industrial solutions provider based in Barcelona.**',
					'',
					'## About Us',
					'Founded in 2005, Acme Corp S.L. (CIF B12345678) specialises in',
					'industrial automation and supply chain solutions for Mediterranean markets.',
					'',
					'## Contact',
					'- Address: Carrer de la Indústria 42, 08025 Barcelona',
					'- Phone: +34 932 000 111',
					'- Email: info@acmecorp.es',
					'',
					'## Key Facts',
					'- Employees: 85',
					'- Revenue: €12M (2025)',
					'- Sector: Industrial automation',
				].join('\n'),
				title: 'Acme Corp S.L. — Industrial Solutions',
				language: 'en',
				contentHash: 'stub-hash-acme-corp',
				units: 0,
			}),
		),
})

export const StubScrapeProvider = Layer.succeed(ScrapeProvider)(
	StubScrapeProviderInstance,
)
