import { describe, expect, it } from 'vitest'

import { outcomeFromRun } from './eval-outcome'

describe('outcomeFromRun', () => {
	describe('when findings carry bare-string enrichment fields', () => {
		it('should read them into the scorable fields', () => {
			// GIVEN today's block-shaped findings
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport', country: 'ES' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the values come through
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.fields.country).toBe('ES')
		})
	})

	describe('when a field is a per-field citation wrapper', () => {
		it('should read the inner value regardless of where its citation points', () => {
			// GIVEN a value that carries its own source — a third-party fact-source
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: {
					enrichment: {
						industry: {
							value: 'transport',
							source_id: 'https://en.wikipedia.org/wiki/Acme',
						},
					},
				},
				fetchedUrls: ['https://www.acme.es/about'],
			})

			// WHEN adapted — THEN the wrapper is unwrapped, and grounding comes from the
			// fetched official site, not the per-field citation (which is a third party)
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.reachedDomains).toEqual(['acme.es'])
		})
	})

	describe('when findings have no enrichment block', () => {
		it('should produce empty fields rather than throwing', () => {
			// GIVEN a failed run whose findings are just an error string
			const outcome = outcomeFromRun({
				status: 'no_reliable_data',
				findings: { error: 'nothing grounded' },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN no fields, and the status carries through
			expect(outcome.fields).toEqual({})
			expect(outcome.status).toBe('no_reliable_data')
		})
	})

	describe('when a non-terminal status slips through', () => {
		it('should treat it as a failed run', () => {
			// GIVEN a run still marked running (should not happen post-completion)
			const outcome = outcomeFromRun({
				status: 'running',
				findings: {},
				fetchedUrls: [],
			})

			// WHEN adapted — THEN it is normalized to failed
			expect(outcome.status).toBe('failed')
		})
	})

	describe('when the run fetched several pages', () => {
		it('should reach each host, stripping www and dropping unparseable URLs', () => {
			// GIVEN the run fetched the official site, a registry, and a bad URL
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [
					'https://www.acme.es/contact',
					'https://librebor.es/company/acme',
					'not a url',
				],
			})

			// WHEN adapted — THEN the reached hosts are normalized, the junk is gone
			expect(outcome.reachedDomains).toEqual(['acme.es', 'librebor.es'])
		})
	})

	describe('when the run fetched nothing', () => {
		it('should reach no domains', () => {
			// GIVEN a run that produced findings but has an empty fetch log
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN nothing grounds it
			expect(outcome.reachedDomains).toEqual([])
		})
	})

	describe('when the DB client camelCased the findings keys', () => {
		it('should still read the snake_case fields', () => {
			// GIVEN findings as the CLI's snakeToCamel client returns them
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: {
					enrichment: { industry: 'transport', sizeRange: '26-50' },
				},
				fetchedUrls: ['https://www.acme.es/about'],
			})

			// WHEN adapted — THEN sizeRange→size_range resolves and the fetch grounds it
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.fields.size_range).toBe('26-50')
			expect(outcome.reachedDomains).toEqual(['acme.es'])
		})
	})

	describe('when the pipeline confirmed the target in the official register', () => {
		it('should carry registryConfirmed through, in snake or camel case', () => {
			// GIVEN a run that fetched no site but stamped the registry-confirmation flag
			const snake = outcomeFromRun({
				status: 'no_reliable_data',
				findings: { registry_confirmed: true, error: 'no site fetched' },
				fetchedUrls: [],
			})
			// AND the CLI's camelCasing client can deliver the same flag camelCased
			const camel = outcomeFromRun({
				status: 'succeeded',
				findings: { registryConfirmed: true, enrichment: { country: 'ES' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN both surface the reached-via-registry signal
			expect(snake.registryConfirmed).toBe(true)
			expect(camel.registryConfirmed).toBe(true)
		})
	})

	describe('when no registry confirmation was recorded', () => {
		it('should leave registryConfirmed false', () => {
			// GIVEN findings without the flag
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the flag defaults false
			expect(outcome.registryConfirmed).toBe(false)
		})
	})
})
