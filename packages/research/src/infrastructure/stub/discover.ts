/**
 * Stub discover provider — returns deterministic fake findings.
 *
 * Exports both the instance (for the provider factory table in
 * `providers-live.ts`) and the standalone Layer (single-slot callers, tests).
 * `cancel` is a no-op since there is no real async job.
 */

import { Effect, Layer } from 'effect'

import { DiscoverProvider } from '../../application/ports'
import { DiscoverResult } from '../../domain/types'

export const StubDiscoverProviderInstance = DiscoverProvider.of({
	discover: _input =>
		Effect.succeed(
			new DiscoverResult({
				findings: [
					'Acme Corp S.L. (CIF B12345678) is a Barcelona-based industrial solutions company.',
					'Founded in 2005, they employ 85 people and reported €12M revenue in 2025.',
					'Key focus areas: industrial automation, supply chain optimisation.',
					'Recent expansion plans target Mediterranean markets (announced Q1 2026).',
				].join('\n'),
				sourcesVisited: [
					'https://acmecorp.es',
					'https://linkedin.com/company/acme-corp-sl',
					'https://news.example.com/acme-expansion',
				],
				units: 0,
			}),
		),
	cancel: _jobRef => Effect.void,
})

export const StubDiscoverProvider = Layer.succeed(DiscoverProvider)(
	StubDiscoverProviderInstance,
)
