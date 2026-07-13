import { describe, expect, it } from 'vitest'

import {
	mergeContacts,
	needsContactRescue,
	normalizeContactName,
} from './contacts-rescue'

describe('needsContactRescue', () => {
	describe('when the broad pass returned few or no named contacts', () => {
		it('should ask for a rescue on zero contacts', () => {
			// GIVEN findings with no contacts
			// THEN a rescue is warranted
			expect(needsContactRescue({ contacts: [] })).toBe(true)
			expect(needsContactRescue({})).toBe(true)
		})

		it('should ask for a rescue on a single contact', () => {
			// GIVEN one named contact
			// THEN still thin enough to rescue
			expect(needsContactRescue({ contacts: [{ name: 'Ada' }] })).toBe(true)
		})

		it('should not count a nameless entry', () => {
			// GIVEN one entry with a blank name
			// THEN it doesn't count, so a rescue is warranted
			expect(needsContactRescue({ contacts: [{ name: '   ' }] })).toBe(true)
		})
	})

	describe('when the broad pass already found people', () => {
		it('should not rescue with two or more named contacts', () => {
			// GIVEN two named contacts
			// THEN the broad pass delivered; no rescue
			expect(
				needsContactRescue({ contacts: [{ name: 'Ada' }, { name: 'Chad' }] }),
			).toBe(false)
		})
	})
})

describe('normalizeContactName', () => {
	it('should fold case, accents, and punctuation to a comparison key', () => {
		// GIVEN two spellings of the same name
		// THEN they reduce to the same key
		expect(normalizeContactName('José García-López')).toBe(
			normalizeContactName('Jose Garcia Lopez'),
		)
		expect(normalizeContactName('  Eric   Fortmeyer ')).toBe('eric fortmeyer')
	})
})

describe('mergeContacts', () => {
	describe('when broad and rescued name different people', () => {
		it('should union them in first-seen order', () => {
			// GIVEN one contact from each pass
			const broad = [{ name: 'Eric Fortmeyer', role: { value: 'CEO' } }]
			const rescued = [{ name: 'Chad Buchanan', role: { value: 'CFO' } }]

			// WHEN merged
			const merged = mergeContacts(broad, rescued)

			// THEN both survive, broad first
			expect(merged.map(c => c.name)).toEqual([
				'Eric Fortmeyer',
				'Chad Buchanan',
			])
		})
	})

	describe('when the same person appears in both', () => {
		it('should keep the broad fields, fill the gaps, and union citations', () => {
			// GIVEN the broad contact has a role but no title source, the rescue adds a
			// citation and a role
			const broad = [
				{
					name: 'Eric Fortmeyer',
					role: { value: 'President & CEO', source_id: 'https://circle.com' },
					citations: [{ source_id: 'https://circle.com' }],
				},
			]
			const rescued = [
				{
					name: 'eric  fortmeyer',
					role: { value: 'CEO' },
					citations: [{ source_id: 'https://circle.com/about' }],
				},
			]

			// WHEN merged
			const merged = mergeContacts(broad, rescued)

			// THEN one contact, broad's richer role kept, citations unioned
			expect(merged).toHaveLength(1)
			expect(merged[0]?.role).toEqual({
				value: 'President & CEO',
				source_id: 'https://circle.com',
			})
			expect(merged[0]?.citations).toEqual([
				{ source_id: 'https://circle.com' },
				{ source_id: 'https://circle.com/about' },
			])
		})

		it('should fill a missing role from the rescue pass', () => {
			// GIVEN the broad contact is name-only, the rescue found the title
			const broad = [{ name: 'Andrew Smith' }]
			const rescued = [
				{ name: 'Andrew Smith', role: { value: 'VP Sales & Operations' } },
			]

			// WHEN merged
			const merged = mergeContacts(broad, rescued)

			// THEN the recovered title lands on the single contact
			expect(merged).toHaveLength(1)
			expect(merged[0]?.role).toEqual({ value: 'VP Sales & Operations' })
		})
	})

	describe('when two names differ by an initial', () => {
		it('should keep both rather than risk merging different people', () => {
			// GIVEN a plain name and a middle-initial variant
			const broad = [{ name: 'Andrew Smith' }]
			const rescued = [{ name: 'Andrew J. Smith' }]

			// WHEN merged
			const merged = mergeContacts(broad, rescued)

			// THEN both are kept (conservative: no lossy merge)
			expect(merged.map(c => c.name)).toEqual([
				'Andrew Smith',
				'Andrew J. Smith',
			])
		})
	})

	describe('when a contact has a blank name', () => {
		it('should drop it', () => {
			// GIVEN a nameless entry
			const merged = mergeContacts([{ name: '  ' }], [{ name: 'Ada' }])

			// THEN only the named one survives
			expect(merged.map(c => c.name)).toEqual(['Ada'])
		})
	})
})
