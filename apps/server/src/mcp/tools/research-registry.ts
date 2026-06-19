import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import { RegistryRouter } from '@batuda/research'

// ── lookup_registry ──
// Standalone, on-demand Spanish mercantile-registry (BORME) lookup via
// libreBORME — for a quick identity check outside a research run (the agent's
// in-run registry_lookup tool covers the same data during a run). Each lookup
// spends one libreBORME credit (~€0.29); not enforced against a budget here
// because the in-run tool loop doesn't meter paid providers either.

const LookupRegistry = Tool.make('lookup_registry', {
	description:
		'Look up a Spanish company in the mercantile registry (libreBORME) by NIF or name. Returns legal name, NIF, status, capital, and directors. Metered: ~€0.29 per lookup.',
	parameters: Schema.Struct({
		country: Schema.Literal('ES'),
		query: Schema.optional(Schema.String),
		tax_id: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})
	.annotate(Tool.Title, 'Lookup Registry')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, true)

// ── Toolkit + handlers ──

export const ResearchRegistryTools = Toolkit.make(LookupRegistry)

export const ResearchRegistryHandlersLive = ResearchRegistryTools.toLayer(
	Effect.gen(function* () {
		const registry = yield* RegistryRouter

		return {
			lookup_registry: params =>
				registry
					.lookup({
						country: params.country,
						query: params.query,
						taxId: params.tax_id,
					})
					// Surface a provider failure (bad credential, not found, no credit)
					// as a readable result the caller can act on, not an opaque defect.
					.pipe(
						Effect.catchTag('ProviderError', e =>
							Effect.succeed({ error: e.message }),
						),
					),
		}
	}),
)
