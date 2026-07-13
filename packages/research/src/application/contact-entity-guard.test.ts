import { describe, expect, it } from 'vitest'

import { bindContactsToEntity } from './contact-entity-guard'
import { deriveEntityTargets } from './entity-guard'

// The run is researching Circle Logistics; targets carry its name-core + domain.
const targets = deriveEntityTargets({
	schemaName: 'company_enrichment_v1',
	query: 'Circle Logistics',
	anchorDomain: 'circledelivers.com',
	subjects: [
		{
			table: 'companies',
			name: 'Circle Logistics',
			website: 'circledelivers.com',
		},
	],
})

const contactsOf = (findings: unknown): Array<{ name: string }> =>
	(findings as { contacts: Array<{ name: string }> }).contacts

describe('bindContactsToEntity', () => {
	describe('when a contact quote names a different company as employer', () => {
		it('should drop the testimonial/client executive', () => {
			// GIVEN a person quoted on the target's site but working for another company
			const findings = {
				contacts: [
					{
						name: 'Mark Riskowitz',
						role: {
							value: 'VP of Operations',
							source_id: 'https://circledelivers.com/testimonials',
							quote: 'Mark Riskowitz, VP of Operations at Caraway Logistics',
						},
					},
				],
			}

			// WHEN bound to the target
			const result = bindContactsToEntity(findings, targets)

			// THEN the wrong-company person is removed
			expect(contactsOf(result.findings)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})

	describe('when a contact quote names the target as employer', () => {
		it('should keep them', () => {
			// GIVEN a press mention naming the target
			const findings = {
				contacts: [
					{
						name: 'Andrew Smith',
						role: {
							value: 'SVP',
							source_id: 'https://circledelivers.com/news',
							quote:
								'Circle Logistics promotes Andrew J. Smith to Senior Vice President',
						},
					},
				],
			}

			// WHEN bound
			const result = bindContactsToEntity(findings, targets)

			// THEN kept
			expect(contactsOf(result.findings)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})
	})

	describe('when a contact quote names no company', () => {
		it('should keep them for the critic to judge', () => {
			// GIVEN a plain title with no employer named
			const findings = {
				contacts: [
					{
						name: 'Chad Buchanan',
						role: {
							value: 'CFO',
							source_id: 'https://circledelivers.com/about',
							quote: 'Chad Buchanan – CFO',
						},
					},
				],
			}

			// WHEN bound
			const result = bindContactsToEntity(findings, targets)

			// THEN kept (no company to contradict the target)
			expect(contactsOf(result.findings)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})
	})

	describe('when the quote names the target and another company', () => {
		it('should keep them (they are tied to the target)', () => {
			// GIVEN a bio mentioning a prior employer alongside the target
			const findings = {
				contacts: [
					{
						name: 'Eric Fortmeyer',
						citations: [
							{
								source_id: 'https://circledelivers.com/about',
								quote:
									'Eric Fortmeyer, CEO of Circle Logistics, previously at Acme Freight',
							},
						],
					},
				],
			}

			// WHEN bound
			const result = bindContactsToEntity(findings, targets)

			// THEN kept
			expect(contactsOf(result.findings)).toHaveLength(1)
		})
	})

	describe('when there is no single target (a discovery scan)', () => {
		it('should be a no-op', () => {
			// GIVEN null targets
			const findings = {
				contacts: [
					{ name: 'X', role: { value: 'VP', quote: 'X, VP at Other Corp' } },
				],
			}

			// WHEN bound with no target
			const result = bindContactsToEntity(findings, null)

			// THEN untouched
			expect(contactsOf(result.findings)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})
	})
})
