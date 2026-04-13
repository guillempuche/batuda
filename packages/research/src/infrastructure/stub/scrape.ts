/**
 * Stub scrape provider — returns deterministic fake markdown for local development.
 *
 * Pattern: Layer.succeed (no dependencies, no I/O, no cost).
 * To add a new real provider, use Layer.effect with HttpClient instead.
 */

import { Effect, Layer } from 'effect'

import { ScrapeProvider } from '../../application/ports'
import { ScrapedPage } from '../../domain/types'

export const StubScrapeProvider = Layer.succeed(ScrapeProvider)(
	ScrapeProvider.of({
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
	}),
)
