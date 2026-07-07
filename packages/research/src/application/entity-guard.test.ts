import { describe, expect, it } from 'vitest'

import {
	classifyEntityMatch,
	deriveEntityTargets,
	type EntityTargets,
} from './entity-guard'

describe('deriveEntityTargets', () => {
	describe('when the schema reports third-party companies', () => {
		it('should return null for a scan or freeform run with no anchored subject', () => {
			// GIVEN a scan/freeform run whose findings are legitimately about other
			// companies, so its own query name need not dominate the evidence
			// WHEN targets are derived with no subjects
			// THEN the run is not entity-gated
			for (const schemaName of [
				'prospect_scan_v1',
				'competitor_scan_v1',
				'freeform',
			]) {
				expect(
					deriveEntityTargets({ schemaName, query: 'anything', subjects: [] }),
				).toBeNull()
			}
		})
	})

	describe('when the run is entity-centric', () => {
		it('should derive keys from the query for a query-only enrichment', () => {
			// GIVEN a company_enrichment_v1 run identified only by a free-text query
			// WHEN targets are derived
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Sunset Transportation, St. Louis MO',
				subjects: [],
			})
			// THEN the pre-comma company name becomes the strong-match core
			expect(targets?.cores).toContain('sunsettransportation')
		})

		it('should derive keys from the subject name and website when anchored', () => {
			// GIVEN any schema but with an anchored company subject
			const targets = deriveEntityTargets({
				schemaName: 'freeform',
				query: 'unused',
				subjects: [
					{
						table: 'companies',
						name: 'Acme Widgets',
						website: 'https://acme.com',
					},
				],
			})
			// THEN the name core is a strong key and the full host is a domain key
			expect(targets?.cores).toContain('acmewidgets')
			expect(targets?.domains).toContain('acme.com')
		})
	})

	describe('when the target has no usable identity', () => {
		it('should return null so nothing false-fails', () => {
			// GIVEN an anchored subject with neither a name nor a website
			// WHEN targets are derived
			// THEN the gate is skipped rather than failing an unidentifiable run
			expect(
				deriveEntityTargets({
					schemaName: 'company_enrichment_v1',
					query: '',
					subjects: [{ table: 'companies' }],
				}),
			).toBeNull()
		})
	})
})

describe('classifyEntityMatch', () => {
	const acme: EntityTargets = {
		cores: ['acmelogistics'],
		words: ['acme'],
		domains: ['acme.com'],
	}

	describe('when the evidence names the target strongly', () => {
		it('should return strong on a full-name match regardless of spacing and legal form', () => {
			// GIVEN a corpus that spells the whole name with a legal form appended
			// WHEN classified
			// THEN the match is strong (folding makes "Acme Logistics S.L." == the core)
			expect(
				classifyEntityMatch(acme, 'Contact Acme Logistics S.L. for a quote'),
			).toBe('strong')
		})

		it('should return strong on the target host, not a passing brand mention', () => {
			// GIVEN a corpus that references the company's own host
			// WHEN classified
			// THEN reaching the target's own site is a strong signal
			expect(
				classifyEntityMatch(acme, 'Homepage at https://www.acme.com/about'),
			).toBe('strong')
		})

		it('should match a name across diacritics', () => {
			// GIVEN a target whose name carries accents
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Cafés Ordóñez',
				subjects: [],
			})
			// WHEN a corpus writes the same name without the accents
			// THEN folding makes the two equal and the match is strong
			expect(classifyEntityMatch(targets!, 'the cafes ordonez brand')).toBe(
				'strong',
			)
		})
	})

	describe('when the evidence only hints at the target', () => {
		it('should return weak when a lone distinctive word appears', () => {
			// GIVEN a corpus that mentions the distinctive word but never the full
			// name or domain
			// WHEN classified
			// THEN the match is weak — it might be the target, not confidently
			expect(
				classifyEntityMatch(acme, 'A profile listing for Acme on a directory'),
			).toBe('weak')
		})
	})

	describe('when the evidence is about a different company', () => {
		it('should return absent so the run fails closed', () => {
			// GIVEN a corpus that names neither the company, its words, nor its domain
			// WHEN classified
			// THEN nothing grounds the target and the verdict is absent
			expect(
				classifyEntityMatch(acme, 'Topia Freight scored 100/100 on LoadWrap'),
			).toBe('absent')
		})

		it('should return absent for a non-existent company whose name is nowhere in the evidence', () => {
			// GIVEN the exact misattribution case: a made-up company
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Zxqvon Interstellar Freight Brokerage LLC',
				subjects: [],
			})
			// WHEN its keys are classified against a corpus about other freight firms
			// THEN the run is absent (its distinctive words appear nowhere)
			expect(
				classifyEntityMatch(targets!, 'Topia and Sunset are freight brokers'),
			).toBe('absent')
		})
	})
})
