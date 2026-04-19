import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'

import {
	Budget,
	ProviderQuota,
	RegistryRouter,
	ReportRouter,
} from '@batuda/research'

// ── lookup_registry ──
// One tool, two backends. depth='basic' → free registry (libreBORME).
// depth='financials'|'full' → paid report (einforma), gated by budget.

const LookupRegistry = Tool.make('lookup_registry', {
	description:
		"Look up a company in the official registry. With depth='basic' (default): free, returns legal name, NIF, capital, directors from libreBORME. With depth='financials' or 'full': paid report from einforma with detailed financials and risk scores. Always try basic first.",
	parameters: Schema.Struct({
		country: Schema.Literal('ES'),
		query: Schema.optional(Schema.String),
		tax_id: Schema.optional(Schema.String),
		depth: Schema.optional(Schema.Literals(['basic', 'financials', 'full'])),
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
		const report = yield* ReportRouter
		const quota = yield* ProviderQuota
		const budget = yield* Budget

		return {
			lookup_registry: params =>
				Effect.gen(function* () {
					const depth = params.depth ?? 'basic'

					if (depth === 'basic') {
						// Free registry (libreBORME) — no budget gate needed.
						const result = yield* registry.lookup({
							country: params.country,
							query: params.query,
							taxId: params.tax_id,
						})
						return result
					}

					// Paid report path — requires tax_id to identify the company.
					if (!params.tax_id) {
						return {
							error: 'tax_id is required for financials/full depth',
						}
					}

					// Einforma charges ~3 EUR per report. The budget gate prevents
					// accidental spend; the LLM should try depth='basic' first.
					yield* quota.check('einforma', 1)
					yield* budget.chargePaid('einforma', 300)
					const result = yield* report.report({
						country: params.country,
						taxId: params.tax_id,
						depth,
					})
					yield* quota.consume('einforma', result.units)
					return result
				}).pipe(Effect.orDie),
		}
	}),
)
