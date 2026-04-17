/**
 * Stub extract provider — returns a deterministic fake company object.
 *
 * Exports both the instance (for the provider factory table in
 * `providers-live.ts`) and the standalone Layer (single-slot callers, tests).
 * Returns `unknown` matching the ExtractProvider port — the caller decodes
 * with Schema.decodeUnknown(schema)(raw).
 */

import { Effect, Layer } from 'effect'

import { ExtractProvider } from '../../application/ports'

export const StubExtractProviderInstance = ExtractProvider.of({
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
})

export const StubExtractProvider = Layer.succeed(ExtractProvider)(
	StubExtractProviderInstance,
)
