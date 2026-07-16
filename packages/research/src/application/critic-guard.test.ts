import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
	applyCriticVerdicts,
	CRITIC_UNSURE_CONFIDENCE,
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
				enrichment: { industry: sourced('services', 'a service') },
			}

			// WHEN collected
			const claims = collectFieldClaims(findings)

			// THEN only the real enrichment field is a claim; the proposal blob is left
			expect(claims.map(c => c.id)).toEqual(['enrichment.industry'])
		})
	})
})

describe('applyCriticVerdicts', () => {
	describe('when a verdict clearly rejects a field', () => {
		it('should blank exactly that field to null and leave its siblings', () => {
			// GIVEN two sourced fields and an 'unsupported' verdict on one
			const findings = {
				enrichment: {
					industry: sourced('retail', 'sells clothes'),
					location: sourced('Barcelona', 'based here'),
				},
			}

			// WHEN the rejecting verdict is applied
			const result = applyCriticVerdicts(findings, [
				{ id: 'enrichment.industry', verdict: 'unsupported' },
				{ id: 'enrichment.location', verdict: 'supported' },
			])

			// THEN only the rejected field is nulled; the supported one is untouched
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toBeNull()
			expect(e['location']).toEqual(sourced('Barcelona', 'based here'))
			expect(result.dropped).toBe(1)
			expect(result.flagged).toBe(0)
		})
	})

	describe('when a verdict is unsure about a field', () => {
		it('should keep the value but stamp it low-confidence', () => {
			// GIVEN a sourced field the judge cannot vouch for or rule out
			const findings = {
				enrichment: { industry: sourced('retail', 'maybe a shop') },
			}

			// WHEN an 'unsure' verdict is applied
			const result = applyCriticVerdicts(findings, [
				{ id: 'enrichment.industry', verdict: 'unsure' },
			])

			// THEN the value survives, carries the low-confidence stamp, and is counted
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toEqual({
				...sourced('retail', 'maybe a shop'),
				confidence: CRITIC_UNSURE_CONFIDENCE,
			})
			expect(result.dropped).toBe(0)
			expect(result.flagged).toBe(1)
		})
	})

	describe('when a verdict id is unknown or a field has no verdict', () => {
		it('should default to keep', () => {
			// GIVEN a field with no matching verdict and an 'unsupported' verdict for a ghost id
			const findings = { enrichment: { industry: sourced('retail', 'q') } }

			// WHEN applied
			const result = applyCriticVerdicts(findings, [
				{ id: 'enrichment.ghost', verdict: 'unsupported' },
			])

			// THEN the real field is untouched
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['industry']).toEqual(sourced('retail', 'q'))
			expect(result.dropped).toBe(0)
			expect(result.flagged).toBe(0)
		})
	})
})

describe('critiqueFieldSupport', () => {
	describe('when the judge clearly rejects one field', () => {
		it('should blank it, keep the rest, and thread the judge tokens', async () => {
			// GIVEN a supported industry, an unsupported size, and a quote-less
			// location (which is never sent to the judge)
			const findings = {
				enrichment: {
					industry: sourced('retail', 'a shop'),
					location: sourced('Barcelona', 'a look-alike company'),
					country: sourced('ES'),
				},
			}
			const judge: CriticJudge = claims =>
				Effect.succeed({
					verdicts: claims.map(c => ({
						id: c.id,
						verdict:
							c.id === 'enrichment.location' ? 'unsupported' : 'supported',
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
			expect(e['location']).toBeNull()
			expect(e['industry']).toEqual(sourced('retail', 'a shop'))
			expect(e['country']).toEqual(sourced('ES'))
			expect(result.criticised).toBe(2)
			expect(result.dropped).toBe(1)
			expect(result.flagged).toBe(0)
			expect(result.outputTokens).toBe(42)
		})
	})

	describe('when the judge is unsure about a field', () => {
		it('should keep the value, stamp it low-confidence, and count it flagged', async () => {
			// GIVEN a supported industry and an unsure size
			const findings = {
				enrichment: {
					industry: sourced('retail', 'a shop'),
					location: sourced('Barcelona', 'a vague location hint'),
				},
			}
			const judge: CriticJudge = claims =>
				Effect.succeed({
					verdicts: claims.map(c => ({
						id: c.id,
						verdict: c.id === 'enrichment.location' ? 'unsure' : 'supported',
					})),
					outputTokens: 7,
				})

			// WHEN critiqued
			const result = await Effect.runPromise(
				critiqueFieldSupport(findings, judge),
			)

			// THEN the unsure field survives with the low-confidence stamp; nothing dropped
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['location']).toEqual({
				...sourced('Barcelona', 'a vague location hint'),
				confidence: CRITIC_UNSURE_CONFIDENCE,
			})
			expect(e['industry']).toEqual(sourced('retail', 'a shop'))
			expect(result.dropped).toBe(0)
			expect(result.flagged).toBe(1)
			expect(result.outputTokens).toBe(7)
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

describe('collectFieldClaims and CRITIC_SKIP_FIELDS', () => {
	describe('when a sourced size_range carries a quote', () => {
		it('should not collect it — a coarse band cannot be quote-matched', () => {
			// GIVEN size_range (a vocab-mapped band) and industry, both quoted
			const findings = {
				enrichment: {
					industry: sourced('retail', 'a shop'),
					size_range: sourced('51-200', 'employs 685 people'),
				},
			}

			// WHEN claims are collected
			const claims = collectFieldClaims(findings)

			// THEN only industry is critiqued; the size band is skipped
			expect(claims.map(c => c.id)).toEqual(['enrichment.industry'])
		})
	})
})

describe('applyCriticVerdicts and CRITIC_SKIP_FIELDS', () => {
	describe('when a stray verdict targets a skipped size_range', () => {
		it('should leave it untouched — the critic never drops a size band', () => {
			// GIVEN a size_range and a verdict that would otherwise blank it
			const findings = {
				enrichment: { size_range: sourced('51-200', 'employs 685 people') },
			}

			// WHEN a hallucinated unsupported verdict for it is applied
			const result = applyCriticVerdicts(findings, [
				{ id: 'enrichment.size_range', verdict: 'unsupported' as const },
			])

			// THEN the size band survives and nothing is counted as dropped
			const e = (result.findings as { enrichment: Record<string, unknown> })
				.enrichment
			expect(e['size_range']).toEqual(sourced('51-200', 'employs 685 people'))
			expect(result.dropped).toBe(0)
		})
	})
})
