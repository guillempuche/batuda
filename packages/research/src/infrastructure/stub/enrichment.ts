/**
 * Stub enrichment provider — deterministic fake people for zero-cost local dev.
 * Mirrors the other stubs; the provider factory table in `providers-live.ts`
 * and single-slot callers/tests both import from here. People come back without
 * emails, so the pipeline exercises the real guess + verify path against them.
 */

import { Effect, Layer } from 'effect'

import { EnrichmentProvider } from '../../application/ports'
import { EnrichmentResult } from '../../domain/types'

export const StubEnrichmentProviderInstance = EnrichmentProvider.of({
	findPeople: _input =>
		Effect.succeed(
			new EnrichmentResult({
				people: [
					{
						firstName: 'Maria',
						lastName: 'Lopez',
						position: 'CEO',
						seniority: 'executive',
						department: 'executive',
						type: 'personal',
						linkedin: 'https://linkedin.com/in/maria-lopez',
						x: 'https://x.com/marialopez',
					},
					{
						firstName: 'Jordi',
						lastName: 'Garcia',
						position: 'Operations Manager',
						seniority: 'senior',
						department: 'operations',
						type: 'personal',
					},
				],
				units: 0,
			}),
		),
})

export const StubEnrichmentProvider = Layer.succeed(EnrichmentProvider)(
	StubEnrichmentProviderInstance,
)
