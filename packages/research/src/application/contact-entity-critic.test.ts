import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
	applyContactVerdicts,
	type ContactEntityJudge,
	type ContactVerdict,
	collectContactClaims,
	contactCriticPrompt,
	critiqueContactEntities,
} from './contact-entity-critic'

// A contact channel the way the extractor emits it: { value, source_id, quote? }.
const sourced = (value: string, quote?: string) => ({
	value,
	source_id: 'https://acme.com',
	...(quote !== undefined ? { quote } : {}),
})

const citation = (quote: string) => ({ source_id: 'https://acme.com', quote })

describe('collectContactClaims', () => {
	describe('when contacts carry quotes on channels and citations', () => {
		it('should emit one claim per named, quoted contact keyed by its index', () => {
			// GIVEN two contacts, one quoted via role, one via a citation
			const findings = {
				contacts: [
					{ name: 'Ada', role: sourced('CEO', 'Ada, CEO') },
					{ name: 'Bo', citations: [citation('Bo leads sales here')] },
				],
			}

			// WHEN claims are collected
			const claims = collectContactClaims(findings)

			// THEN one claim per contact, id = its list index, quotes gathered
			expect(claims).toEqual([
				{ id: '0', name: 'Ada', quotes: ['Ada, CEO'] },
				{ id: '1', name: 'Bo', quotes: ['Bo leads sales here'] },
			])
		})
	})

	describe('when a contact has a name but no quote anywhere', () => {
		it('should skip it — the critic has nothing to judge, so it is kept', () => {
			// GIVEN a contact with no channel quote and no citations
			const findings = { contacts: [{ name: 'Ada', role: sourced('CEO') }] }

			// WHEN collected
			const claims = collectContactClaims(findings)

			// THEN no claim (a quote-less contact is left to the deterministic guard)
			expect(claims).toEqual([])
		})
	})

	describe('when a contact has no usable name', () => {
		it('should skip a blank or non-string name', () => {
			// GIVEN contacts with an empty name and a non-string name
			const findings = {
				contacts: [
					{ name: '  ', citations: [citation('quote')] },
					{ name: 42, citations: [citation('quote')] },
				],
			}

			// WHEN collected
			const claims = collectContactClaims(findings)

			// THEN neither yields a claim
			expect(claims).toEqual([])
		})
	})

	describe('when the shape carries no contacts array', () => {
		it('should return an empty list', () => {
			// GIVEN a scan-style finding with no contacts key
			// WHEN collected
			// THEN empty
			expect(collectContactClaims({ enrichment: {} })).toEqual([])
			expect(collectContactClaims({ contacts: 'nope' })).toEqual([])
			expect(collectContactClaims(null)).toEqual([])
		})
	})

	describe('when an earlier contact is skipped for having no quote', () => {
		it('should keep ids aligned to the ORIGINAL contact index', () => {
			// GIVEN index 0 is quote-less (skipped) and index 1 is quoted
			const findings = {
				contacts: [
					{ name: 'NoQuote', role: sourced('CTO') },
					{
						name: 'Quoted',
						citations: [citation('a testimonial from Quoted')],
					},
				],
			}

			// WHEN collected
			const claims = collectContactClaims(findings)

			// THEN the only claim keeps id '1', matching its position in the array
			expect(claims).toEqual([
				{ id: '1', name: 'Quoted', quotes: ['a testimonial from Quoted'] },
			])
		})
	})
})

describe('applyContactVerdicts', () => {
	const findings = {
		enrichment: { industry: sourced('transport', 'a carrier') },
		contacts: [
			{ name: 'Ada', role: sourced('CEO', 'Ada, CEO') },
			{ name: 'Client', role: sourced('buyer', 'great service! — Client') },
		],
	}

	describe('when the judge rules a contact an outsider', () => {
		it('should drop only that contact and preserve the rest of the findings', () => {
			// GIVEN a verdict marking contact 1 an outsider
			const verdicts: ContactVerdict[] = [
				{ id: '0', verdict: 'own_staff' },
				{ id: '1', verdict: 'outsider' },
			]

			// WHEN applied
			const result = applyContactVerdicts(findings, verdicts)

			// THEN contact 1 is gone, contact 0 and enrichment untouched
			expect(result.dropped).toBe(1)
			expect(result.findings).toEqual({
				enrichment: { industry: sourced('transport', 'a carrier') },
				contacts: [{ name: 'Ada', role: sourced('CEO', 'Ada, CEO') }],
			})
		})
	})

	describe('when the judge is unsure, approves, or omits a verdict', () => {
		it('should keep every contact — only a clear outsider drops', () => {
			// GIVEN unsure + own_staff + an unknown id, no outsider
			const verdicts: ContactVerdict[] = [
				{ id: '0', verdict: 'unsure' },
				{ id: '1', verdict: 'own_staff' },
				{ id: '9', verdict: 'outsider' },
			]

			// WHEN applied
			const result = applyContactVerdicts(findings, verdicts)

			// THEN nothing is dropped and the object is returned unchanged
			expect(result.dropped).toBe(0)
			expect(result.findings).toBe(findings)
		})
	})

	describe('when the verdict list is empty (a failed judge)', () => {
		it('should keep all contacts (fail-open)', () => {
			// GIVEN no verdicts
			// WHEN applied
			const result = applyContactVerdicts(findings, [])

			// THEN unchanged
			expect(result.dropped).toBe(0)
			expect(result.findings).toBe(findings)
		})
	})
})

describe('critiqueContactEntities', () => {
	describe('when there are no quoted contacts', () => {
		it('should not call the judge and return the findings unchanged', async () => {
			// GIVEN a finding with only a quote-less contact
			const findings = { contacts: [{ name: 'Ada', role: sourced('CEO') }] }
			const judge = vi.fn<ContactEntityJudge>(() =>
				Effect.succeed({ verdicts: [] }),
			)

			// WHEN critiqued
			const result = await Effect.runPromise(
				critiqueContactEntities(findings, judge),
			)

			// THEN the judge is never called and nothing changes
			expect(judge).not.toHaveBeenCalled()
			expect(result).toEqual({
				findings,
				criticised: 0,
				dropped: 0,
			})
		})
	})

	describe('when the judge flags an outsider', () => {
		it("should drop that contact and keep the company's own staff", async () => {
			// GIVEN a real staffer and a testimonial client, both quoted
			const findings = {
				contacts: [
					{ name: 'Ada', role: sourced('CEO', 'Ada, our CEO') },
					{ name: 'Client', citations: [citation('great service! — Client')] },
				],
			}
			const judge: ContactEntityJudge = claims =>
				Effect.succeed({
					verdicts: claims.map(c => ({
						id: c.id,
						verdict:
							c.name === 'Client'
								? ('outsider' as const)
								: ('own_staff' as const),
					})),
				})

			// WHEN critiqued
			const result = await Effect.runPromise(
				critiqueContactEntities(findings, judge),
			)

			// THEN only the client is dropped, and both were judged
			expect(result.criticised).toBe(2)
			expect(result.dropped).toBe(1)
			expect(
				(result.findings as { contacts: Array<{ name: string }> }).contacts.map(
					c => c.name,
				),
			).toEqual(['Ada'])
		})
	})

	describe('when the judge returns no verdicts (fails open)', () => {
		it('should keep every contact', async () => {
			// GIVEN a judge that yields nothing (a caught error path in the wiring)
			const findings = {
				contacts: [{ name: 'Ada', role: sourced('CEO', 'Ada, CEO') }],
			}
			const judge: ContactEntityJudge = () => Effect.succeed({ verdicts: [] })

			// WHEN critiqued
			const result = await Effect.runPromise(
				critiqueContactEntities(findings, judge),
			)

			// THEN the contact survives
			expect(result.dropped).toBe(0)
			expect(
				(result.findings as { contacts: unknown[] }).contacts,
			).toHaveLength(1)
		})
	})
})

describe('contactCriticPrompt', () => {
	describe('when building the judge prompt', () => {
		it('should name the target and list each id, name, and quote', () => {
			// GIVEN a target and one claim
			const prompt = contactCriticPrompt({ name: 'Acme', domain: 'acme.com' }, [
				{ id: '0', name: 'Ada', quotes: ['Ada, CEO'] },
			])

			// THEN the prompt carries the company, the id, the name, and the quote
			expect(prompt).toContain('"Acme"')
			expect(prompt).toContain('acme.com')
			expect(prompt).toContain('id=0')
			expect(prompt).toContain('Ada')
			expect(prompt).toContain('Ada, CEO')
		})
	})
})
