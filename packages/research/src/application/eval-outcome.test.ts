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

	describe('when a run succeeded with low confidence', () => {
		it('should keep the status instead of coercing it to failed', () => {
			// GIVEN a finished thin run with real findings
			const outcome = outcomeFromRun({
				status: 'succeeded_low_confidence',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the low-confidence success carries through
			expect(outcome.status).toBe('succeeded_low_confidence')
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

	describe('when the findings carry a size band', () => {
		it('should read it under the name the schema defines', () => {
			// GIVEN findings that include the size band
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: {
					enrichment: { industry: 'transport', size_range: '11-50' },
				},
				fetchedUrls: ['https://www.acme.es/about'],
			})

			// WHEN adapted — THEN the field resolves and the fetched page grounds it
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.fields.size_range).toBe('11-50')
			expect(outcome.reachedDomains).toEqual(['acme.es'])
		})
	})

	describe('when the pipeline confirmed the target in the official register', () => {
		it('should carry registryConfirmed through', () => {
			// GIVEN a run that fetched no site but stamped the registry-confirmation flag
			const outcome = outcomeFromRun({
				status: 'no_reliable_data',
				findings: { registry_confirmed: true, error: 'no site fetched' },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN it surfaces the reached-via-registry signal
			expect(outcome.registryConfirmed).toBe(true)
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

	describe('when the run answered with a list of companies', () => {
		it('should read the companies a scan found, and whether each has a site', () => {
			// GIVEN a prospect scan that came back with three companies, two of them
			// carrying a website
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [
						{ name: 'Acme', website: 'https://acme.test' },
						{ name: 'Beta', website: '   ' },
						{ name: 'Gamma', website: 'https://gamma.test' },
						{ website: 'https://nameless.test' },
					],
				},
				fetchedUrls: [],
			})

			// WHEN adapted
			// THEN the scan's own answer is visible to the scorer. Reading only the
			// profile block made every scan look like a run that found nothing, which
			// is why no scan could ever be measured
			expect(outcome.companies).toEqual([
				{ name: 'Acme', hasWebsite: true },
				{ name: 'Beta', hasWebsite: false },
				{ name: 'Gamma', hasWebsite: true },
			])
		})

		it('should read no companies when the run answers with a profile', () => {
			// GIVEN an enrichment run, whose answer is a profile rather than a list
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'company_enrichment_v1',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN there is no list to read, and the shape decides that
			expect(outcome.companies).toEqual([])
		})
	})
})
