import { describe, expect, it } from 'vitest'

import {
	bindContactsToEntity,
	bindScanContactsToRows,
} from './contact-entity-guard'
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
}).targets

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

describe('bindScanContactsToRows', () => {
	const row = (name: string, contacts: ReadonlyArray<unknown>) => ({
		name,
		contacts,
	})
	const person = (name: string, quote: string) => ({
		name,
		citations: [{ quote, source_id: 'https://example.com', confidence: 90 }],
	})
	const contactsOn = (findings: unknown, at: number): unknown =>
		(
			(findings as { prospects: ReadonlyArray<Record<string, unknown>> })
				.prospects[at] as Record<string, unknown>
		)['contacts']

	describe('when a person on one row is evidenced by another company', () => {
		it('should drop them from that row and leave the rest alone', () => {
			// GIVEN two companies, where the second row carries a director whose only
			// quote names the first — the quiet mistake of filing somebody under the
			// company listed above them
			const findings = {
				prospects: [
					row('Calderería Sentmenat SL', [
						person('Marta Puig', 'Marta Puig, Gerent at Sentmenat Group'),
					]),
					row('Talleres Vidal SL', [
						person('Jordi Roca', 'Jordi Roca, Director at Sentmenat Group'),
					]),
				],
			}

			// WHEN each row's people are held against that row
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN the misfiled one goes and the rightly-filed one stays
			expect(result.dropped).toBe(1)
			expect(contactsOn(result.findings, 1)).toEqual([])
			expect(
				(contactsOn(result.findings, 0) as ReadonlyArray<{ name: string }>)[0]
					?.name,
			).toBe('Marta Puig')
		})
	})

	describe('when the evidence names no company at all', () => {
		it('should keep the person', () => {
			// GIVEN a quote that reads the same for a real member of staff as for a
			// stranger
			const findings = {
				prospects: [
					row('Talleres Vidal SL', [
						person('Anna Serra', 'Anna Serra, Gerent'),
					]),
				],
			}

			// WHEN checked — THEN they stay: losing real people is the worse mistake
			expect(bindScanContactsToRows(findings, 'prospects').dropped).toBe(0)
		})
	})

	describe('when the row name is too plain to decide anything', () => {
		it('should keep everyone rather than half-check them', () => {
			// GIVEN a company whose name has nothing distinctive to hold a quote
			// against
			const findings = {
				prospects: [row('SL', [person('Pau Mas', 'Pau Mas at Other Group')])],
			}

			// WHEN checked — THEN nobody is dropped, because a name that answers to
			// every quote cannot decide this one
			expect(bindScanContactsToRows(findings, 'prospects').dropped).toBe(0)
		})
	})

	describe('when the run is not a scan shape', () => {
		it('should leave the findings untouched', () => {
			// GIVEN no list field, which is what a run about one company passes
			const findings = { contacts: [person('X', 'X at Y Group')] }

			// WHEN checked — THEN it is the same object back, not a rebuilt copy
			const result = bindScanContactsToRows(findings, undefined)
			expect(result.findings).toBe(findings)
			expect(result.dropped).toBe(0)
		})
	})
})
