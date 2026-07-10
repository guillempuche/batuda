import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
	applyCriticVerdicts,
	type CriticJudge,
	collectFieldClaims,
	critiqueFieldSupport,
} from './critic-guard'

const sourced = (value: string, quote?: string) => ({
	value,
	source_id: 'https://acme.es',
	...(quote !== undefined ? { quote } : {}),
})

describe('collectFieldClaims', () => {
	describe('when a finding has sourced enrichment scalars and contacts', () => {
		it('should emit one claim per quoted sourced field with a stable dotted id', () => {
			// GIVEN enrichment + contact fields, each a { value, source_id, quote }
			const findings = {
				enrichment: {
					industry: sourced('retail', 'sells clothes'),
					location: sourced('Barcelona', 'based in Barcelona'),
				},
				contacts: [{ name: 'Ada', email: sourced('ada@acme.es', 'email Ada') }],
			}

			// WHEN claims are collected
			const claims = collectFieldClaims(findings)

			// THEN one claim per quoted field, keyed by its path
			expect(claims.map(c => c.id).sort()).toEqual([
				'contacts.0.email',
				'enrichment.industry',
				'enrichment.location',
			])
			expect(claims.find(c => c.id === 'contacts.0.email')?.field).toBe('email')
		})
	})

	describe('when a sourced field has no quote', () => {
		it('should skip it — there is nothing to check the value against', () => {
			// GIVEN a sourced field with no quote (quote is optional)
			const findings = { enrichment: { industry: sourced('retail') } }

			// WHEN collected
			const claims = collectFieldClaims(findings)

			// THEN no claim is produced
			expect(claims).toEqual([])
		})
	})

	describe('when the finding carries no sourced fields', () => {
		it('should return an empty list for a scan-style shape', () => {
			// GIVEN a shape with plain strings and block citations, no wrappers
			const findings = {
				competitors: [{ name: 'Rival', citations: [{ source_id: 's1' }] }],
			}

			// WHEN collected
			// THEN nothing to critique
			expect(collectFieldClaims(findings)).toEqual([])
		})
	})

	describe('when sourced-looking objects sit inside skipped subtrees', () => {
		it('should not descend into citations or proposed_updates', () => {
			// GIVEN a { value, source_id } object nested in a proposal's fields blob
			const findings = {
				proposed_updates: [
					{
						fields: {
							industry: { value: 'retail', source_id: 's1', quote: 'q' },
						},
					},
				],
				enrichment: { industry: sourced('serveis', 'a service') },
			}

			// WHEN collected
			const claims = collectFieldClaims(findings)

			// THEN only the real enrichment field is a claim; the proposal blob is left
			expect(claims.map(c => c.id)).toEqual(['enrichment.industry'])
		})
	})
})

describe('applyCriticVerdicts', () => {
	describe('when a verdict rejects a field', () => {
		it('should blank exactly that field to null and leave its siblings', () => {
			// GIVEN two sourced fields and a verdict dropping one
			const findings = {
				enrichment: {
					industry: sourced('retail', 'sells clothes'),
					location: sourced('Barcelona', 'based here'),
				},
			}

			// WHEN the rejecting verdict is applied
			const result = applyCriticVerdicts(findings, [
				{ id: 'enrichment.industry', keep: false },
				{ id: 'enrichment.location', keep: true },
			])

			// THEN only the rejected field is nulled
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toBeNull()
			expect(e['location']).toEqual(sourced('Barcelona', 'based here'))
			expect(result.dropped).toBe(1)
		})
	})

	describe('when a verdict id is unknown or a field has no verdict', () => {
		it('should default to keep', () => {
			// GIVEN a field with no matching verdict and a verdict for a ghost id
			const findings = { enrichment: { industry: sourced('retail', 'q') } }

			// WHEN applied
			const result = applyCriticVerdicts(findings, [
				{ id: 'enrichment.ghost', keep: false },
			])

			// THEN the real field is untouched
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toEqual(sourced('retail', 'q'))
			expect(result.dropped).toBe(0)
		})
	})
})

describe('critiqueFieldSupport', () => {
	describe('when the judge rejects one field', () => {
		it('should blank it, keep the rest, and thread the judge tokens', async () => {
			// GIVEN a supported industry, an unsupported size, and a quote-less
			// location (which is never sent to the judge)
			const findings = {
				enrichment: {
					industry: sourced('retail', 'a shop'),
					size_range: sourced('26-50', 'a look-alike company'),
					location: sourced('Barcelona'),
				},
			}
			const judge: CriticJudge = claims =>
				Effect.succeed({
					verdicts: claims.map(c => ({
						id: c.id,
						keep: c.id !== 'enrichment.size_range',
					})),
					outputTokens: 42,
				})

			// WHEN critiqued
			const result = await Effect.runPromise(
				critiqueFieldSupport(findings, judge),
			)

			// THEN the rejected field is null, the others survive, counters are right
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['size_range']).toBeNull()
			expect(e['industry']).toEqual(sourced('retail', 'a shop'))
			expect(e['location']).toEqual(sourced('Barcelona'))
			expect(result.criticised).toBe(2)
			expect(result.dropped).toBe(1)
			expect(result.outputTokens).toBe(42)
		})
	})

	describe('when there are no sourced+quoted fields to critique', () => {
		it('should return findings unchanged and never call the judge', async () => {
			// GIVEN findings with nothing to critique
			const findings = { competitors: [{ name: 'Rival' }] }
			const judge = vi.fn<CriticJudge>(() =>
				Effect.succeed({ verdicts: [], outputTokens: 0 }),
			)

			// WHEN critiqued
			const result = await Effect.runPromise(
				critiqueFieldSupport(findings, judge),
			)

			// THEN the judge was never invoked and nothing changed
			expect(judge).not.toHaveBeenCalled()
			expect(result.findings).toBe(findings)
			expect(result.outputTokens).toBe(0)
		})
	})
})
