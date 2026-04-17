/**
 * Stub Spanish report provider — returns a deterministic fake company report.
 *
 * Exports both the instance (for the provider factory table in
 * `providers-live.ts`) and the standalone Layer (single-slot callers, tests).
 */

import { Effect, Layer } from 'effect'

import { ReportRouter } from '../../application/ports'
import { CompanyReport } from '../../domain/types'

export const StubReportEsProviderInstance = ReportRouter.of({
	report: input =>
		Effect.succeed(
			new CompanyReport({
				legalName: 'ACME CORP S.L.',
				taxId: input.taxId,
				depth: input.depth,
				financials:
					input.depth === 'basic'
						? undefined
						: {
								revenue_2025: 12_000_000,
								ebitda_2025: 1_800_000,
								net_profit_2025: 1_200_000,
								total_assets: 8_500_000,
								total_liabilities: 3_200_000,
							},
				shareholders:
					input.depth === 'full'
						? [
								{
									name: 'GARCIA LOPEZ, MARIA',
									percentage: 60,
								},
								{
									name: 'FERNANDEZ RUIZ, CARLOS',
									percentage: 40,
								},
							]
						: undefined,
				riskScore: 25,
				units: 0,
			}),
		),
})

export const StubReportEsProvider = Layer.succeed(ReportRouter)(
	StubReportEsProviderInstance,
)
