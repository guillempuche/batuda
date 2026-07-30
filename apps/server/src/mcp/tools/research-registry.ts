import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import {
	AcceptedCountry,
	noRegistryResult,
	RegistryRouter,
} from '@batuda/research'

// ── lookup_registry ──
// Standalone, on-demand national-registry lookup — for a quick identity check
// outside a research run (the agent's in-run registry_lookup tool covers the
// same data during a run). Routes by country: ES → libreBORME, GB → Companies
// House; a country with no national registry comes back as {status:"no_registry"}.
// A paid lookup (e.g. libreBORME ~€0.29) isn't enforced against a budget here
// because the in-run tool loop doesn't meter paid providers either.

const LookupRegistry = Tool.make('lookup_registry', {
	description:
		'Look up a company in its national business registry by tax id or name. Returns legal name, tax id, status, and (when available) directors. Prefer tax_id when the company record already holds one (get_company shows it): it resolves exactly, where a name can match the wrong firm. A country without a national registry returns {status:"no_registry"} — use discover_contacts there. Some registries are metered (e.g. ES libreBORME ~€0.29/lookup), so store what you learn on the company with update_company rather than looking the same one up twice.',
	parameters: Schema.Struct({
		country: AcceptedCountry.annotate({
			description:
				'ISO 3166-1 alpha-2 country code (any case). Determines which national registry to query.',
		}),
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
						country: params.country.toUpperCase(),
						query: params.query,
						taxId: params.tax_id,
					})
					.pipe(
						// A registry-less country is a routing answer, not a failure —
						// hand it back as data pointing at the universal contact path.
						Effect.catchTag('NoRegistry', e =>
							Effect.succeed(noRegistryResult(e.country)),
						),
						// Surface a provider failure (bad credential, not found, no credit)
						// as a readable result the caller can act on, not an opaque defect.
						Effect.catchTag('ProviderError', e =>
							Effect.succeed({ error: e.message }),
						),
					),
		}
	}),
)
