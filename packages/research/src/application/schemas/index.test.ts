import { describe, expect, it } from 'vitest'

import { schemaFieldNames } from './index'

describe('schemaFieldNames', () => {
	describe('when a run fills in a company profile', () => {
		it('should name the people and the rest of the profile, not only the scalars', () => {
			// GIVEN the enrichment shape, whose people are the thing a run most often
			// comes back missing
			const names = schemaFieldNames('company_enrichment_v1')

			// THEN the agent is told they are wanted at all
			expect(names).toContain('contacts')
			expect(names).toContain('competitors')
			// AND the profile's own fields are named one by one, since each is a
			// separate thing to go and find out
			expect(names).toContain('enrichment.industry')
			expect(names).toContain('enrichment.country')
			// AND a field that is one of a fixed set of answers stays whole: there
			// is nothing inside a verdict to go and find
			expect(names).toContain('verdict')
			expect(names).toContain('verdict_rationale')
		})
	})

	describe('when a block sits behind an optional wrapper', () => {
		it('should open the block and leave the list closed', () => {
			// GIVEN a scan with both shapes at once: a list of competitors, and a
			// market summary that may be left out
			// THEN naming the block alone would say nothing about what goes in it,
			//      while the list is named without spelling out each entry — pinned
			//      exactly, so opening a list or closing a block both fail here
			expect(schemaFieldNames('competitor_scan_v1')).toEqual([
				'competitors',
				'market_summary.total_competitors_found',
				'market_summary.market_maturity',
				'market_summary.key_differentiators',
				'market_summary.citations',
			])
		})
	})

	describe('when a field is a list of repeated things', () => {
		it('should name the list without spelling out each entry', () => {
			// GIVEN a scan that comes back with many prospects
			// THEN knowing to go and find prospects is the useful part; each one's
			// own fields are a detail for whoever writes them down, and every extra
			// word competes for a small model's attention
			expect(schemaFieldNames('prospect_scan_v1')).toEqual(['prospects'])
			expect(schemaFieldNames('contact_discovery_v1')).toEqual(['contacts'])
		})
	})

	describe('when the run writes a brief rather than a profile', () => {
		it('should name nothing, so the prompt keeps its short form', () => {
			// GIVEN a freeform run, whose shape holds only the plumbing that hands
			// work back to the CRM
			expect(schemaFieldNames('freeform')).toEqual([])
		})
	})

	describe('when the schema is not one we know', () => {
		it('should return nothing rather than fail a run', () => {
			expect(schemaFieldNames('made_up_v9')).toEqual([])
		})
	})
})
