import { describe, expect, it } from 'vitest'

import {
	type DiscoveredEntry,
	filterDiscoveredExisting,
	readDiscoveredEntry,
} from './discovered-existing-guard'

describe('readDiscoveredEntry', () => {
	describe('when the shape is a usable discovered row', () => {
		it('should read a companies entry', () => {
			// GIVEN a well-formed entry
			const entry = readDiscoveredEntry({
				subject_table: 'companies',
				subject_id: '11111111-1111-1111-1111-111111111111',
				name: 'Acme',
			})
			// THEN its fields come through
			expect(entry).toEqual({
				subjectTable: 'companies',
				subjectId: '11111111-1111-1111-1111-111111111111',
				name: 'Acme',
			} satisfies DiscoveredEntry)
		})

		it('should keep an entry that has only a name (id missing)', () => {
			// GIVEN an entry the model left without an id
			const entry = readDiscoveredEntry({
				subject_table: 'contacts',
				name: 'Jane Doe',
			})
			// THEN it is still usable — resolution can match on name
			expect(entry?.subjectId).toBe('')
			expect(entry?.name).toBe('Jane Doe')
		})
	})

	describe('when the shape cannot be a discovered row', () => {
		it('should reject a foreign subject_table', () => {
			expect(
				readDiscoveredEntry({ subject_table: 'invoices', subject_id: 'x' }),
			).toBeNull()
		})

		it('should reject an entry with neither a usable id nor a name', () => {
			expect(
				readDiscoveredEntry({ subject_table: 'companies', subject_id: '' }),
			).toBeNull()
		})
	})
})

describe('filterDiscoveredExisting', () => {
	describe('when subject_ids do not resolve to a live row', () => {
		it('should drop the garbage entries reported in #303', () => {
			// GIVEN the exact malformed subject_ids seen in the field — a company name,
			// a docket number, scraped page text, and "0"
			const findings = {
				discovered_existing: [
					{
						subject_table: 'companies',
						subject_id: 'DFW GLOBAL TRUCKING LLC',
						name: 'DFW Global Trucking',
					},
					{
						subject_table: 'companies',
						subject_id: 'MC362542',
						name: 'Summit',
					},
					{ subject_table: 'contacts', subject_id: 'Main!', name: 'Main' },
					{ subject_table: 'contacts', subject_id: '0', name: '' },
				],
			}
			// WHEN nothing resolves to a live row
			const out = filterDiscoveredExisting(findings, () => false)
			// THEN every phantom entry is dropped
			expect(out.dropped).toBe(4)
			expect(
				(out.findings as { discovered_existing: unknown[] })
					.discovered_existing,
			).toHaveLength(0)
		})
	})

	describe('when an entry resolves to a live row', () => {
		it('should keep it and drop only the unresolved ones', () => {
			// GIVEN one real match (by name) among phantoms
			const findings = {
				discovered_existing: [
					{ subject_table: 'companies', subject_id: 'bad-id', name: 'Real Co' },
					{ subject_table: 'companies', subject_id: 'MC1', name: 'Phantom' },
				],
			}
			// WHEN only the named one resolves
			const out = filterDiscoveredExisting(
				findings,
				entry => entry.name === 'Real Co',
			)
			// THEN the real match survives and the phantom is dropped
			expect(out.dropped).toBe(1)
			const kept = (out.findings as { discovered_existing: { name: string }[] })
				.discovered_existing
			expect(kept).toHaveLength(1)
			expect(kept[0]?.name).toBe('Real Co')
		})
	})

	describe('when there is nothing to filter', () => {
		it('should leave other findings untouched and report zero drops', () => {
			// GIVEN findings with no discovered_existing
			const findings = { enrichment: { industry: { value: 'transport' } } }
			// WHEN the guard runs
			const out = filterDiscoveredExisting(findings, () => true)
			// THEN nothing changes
			expect(out.dropped).toBe(0)
			expect(out.findings).toEqual(findings)
		})
	})
})
