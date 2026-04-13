/**
 * Stub extract provider — returns a deterministic fake company object.
 *
 * Pattern: Layer.succeed (no dependencies, no I/O, no cost).
 * Returns `unknown` matching the ExtractProvider port contract —
 * the caller decodes with Schema.decodeUnknown(schema)(raw).
 */

import { Effect, Layer } from 'effect'

import { ExtractProvider } from '../../application/ports'

export const StubExtractProvider = Layer.succeed(ExtractProvider)(
	ExtractProvider.of({
		extract: _input =>
			Effect.succeed({
				company_name: 'Acme Corp S.L.',
				tax_id: 'B12345678',
				address: 'Carrer de la Indústria 42, 08025 Barcelona',
				phone: '+34 932 000 111',
				email: 'info@acmecorp.es',
				website: 'https://acmecorp.es',
				employees: 85,
				revenue_eur: 12_000_000,
				sector: 'Industrial automation',
				founded_year: 2005,
			}),
	}),
)
