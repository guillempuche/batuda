import { describe, expect, it } from 'vitest'

import {
	contactsRescuePrompt,
	mergeContacts,
	needsContactRescue,
	normalizeContactName,
} from './contacts-rescue'

// A contact with a real title, as the broad pass returns one when it does its job.
const titled = (name: string, role: string) => ({
	name,
	role: { value: role, source_id: 's1', confidence: null },
})

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

	describe('when the broad pass already found people with titles', () => {
		it('should not rescue with two or more titled contacts', () => {
			// GIVEN two named contacts that both carry a title
			// THEN the broad pass delivered; no rescue
			expect(
				needsContactRescue({
					contacts: [titled('Ada', 'CEO'), titled('Chad', 'CFO')],
				}),
			).toBe(false)
		})
	})

	describe('when contacts came back named but without a title', () => {
		it('should rescue even with a full list — a titleless contact is a miss', () => {
			// GIVEN several named people, none with a title (the Lectra symptom)
			// THEN a rescue is warranted to recover the titles
			expect(
				needsContactRescue({
					contacts: [{ name: 'Ada' }, { name: 'Chad' }, { name: 'Grace' }],
				}),
			).toBe(true)
		})

		it('should rescue when even one of many contacts lacks a title', () => {
			// GIVEN a list where one person's title is missing
			// THEN the focused pass runs to fill it
			expect(
				needsContactRescue({
					contacts: [titled('Ada', 'CEO'), { name: 'Chad' }],
				}),
			).toBe(true)
		})

		it('should treat a guard-nulled title as missing', () => {
			// GIVEN a contact whose title a guard emptied to null
			// THEN it still counts as titleless, so a rescue is warranted
			expect(
				needsContactRescue({
					contacts: [
						titled('Ada', 'CEO'),
						{ name: 'Chad', role: { value: null, source_id: 's1' } },
					],
				}),
			).toBe(true)
		})
	})
})

describe('contactsRescuePrompt', () => {
	describe('when the run has fetched source URLs', () => {
		it('should hand the model those exact URLs to cite', () => {
			// GIVEN a source manifest of the run's fetched pages
			const prompt = contactsRescuePrompt(
				{ name: 'Acme', domain: 'acme.com' },
				'EVIDENCE',
				'https://acme.com/about\nhttps://acme.com/team',
			)

			// THEN the prompt asks the model to copy one of those verbatim, so a
			// recovered title cites a page the citation guard will match
			expect(prompt).toContain('https://acme.com/team')
			expect(prompt).toContain('copied verbatim')
		})
	})

	describe('when the run has no source manifest', () => {
		it('should still ask for the exact source URL, without a list', () => {
			// GIVEN no manifest
			const prompt = contactsRescuePrompt({ name: 'Acme' }, 'EVIDENCE')

			// THEN it falls back to asking for the source URL each fact came from
			expect(prompt).toContain('the exact source URL it came from')
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
