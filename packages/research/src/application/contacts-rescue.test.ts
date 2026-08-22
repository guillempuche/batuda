import { describe, expect, it } from 'vitest'

import {
	contactsRescuePrompt,
	mergeContacts,
	normalizeContactName,
} from './contacts-rescue'

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

describe('normalizeContactName, on a name outside plain a-z', () => {
	describe('when the name is written in another writing system', () => {
		it('should give it a key of its own rather than none', () => {
			// GIVEN five people named in five writing systems
			// WHEN each name is folded
			// THEN each gets its own key. Folding them all to nothing made them one
			// person to the merge below, and the guard that refuses a nameless entry
			// then threw every one of them away
			const keys = [
				'王小明',
				'Иван Петров',
				'محمد العلي',
				'김민준',
				'Γιώργος Παπάς',
			].map(normalizeContactName)
			expect(keys.some(key => key === '')).toBe(false)
			expect(new Set(keys).size).toBe(keys.length)
		})
	})

	describe('when a Latin letter is a letter rather than an accented one', () => {
		it('should keep the letter instead of leaving a hole where it was', () => {
			// GIVEN Polish and Norwegian names, in the markets this actually runs in
			// WHEN each is folded
			// THEN the letter survives. Writing out only a-z deleted it outright, so
			// Łukasz keyed as "ukasz" and the two passes never met
			expect(normalizeContactName('Łukasz Nowak')).toBe('łukasz nowak')
			expect(normalizeContactName('Bjørn Håland')).toBe('bjørn haland')
		})
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
			expect(merged.contacts.map(c => c.name)).toEqual([
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
			expect(merged.contacts).toHaveLength(1)
			expect(merged.contacts[0]?.role).toEqual({
				value: 'President & CEO',
				source_id: 'https://circle.com',
			})
			expect(merged.contacts[0]?.citations).toEqual([
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
			expect(merged.contacts).toHaveLength(1)
			expect(merged.contacts[0]?.role).toEqual({
				value: 'VP Sales & Operations',
			})
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
			expect(merged.contacts.map(c => c.name)).toEqual([
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
			expect(merged.contacts.map(c => c.name)).toEqual(['Ada'])
		})
	})
})

describe('mergeContacts, on names outside plain a-z', () => {
	describe('when the people are named in several writing systems', () => {
		it('should hand every one of them back', () => {
			// GIVEN four people named outside the Latin alphabet and one inside it
			const broad = [
				{ name: '王小明' },
				{ name: 'Иван Петров' },
				{ name: 'محمد العلي' },
				{ name: '김민준' },
				{ name: 'Núria Pla' },
			]

			// WHEN merged with a second pass that found nobody new
			const merged = mergeContacts(broad, [])

			// THEN nobody is lost. A fold with letters only for a-z handed back Núria
			// alone, with no error and no count — four people gone from a run that
			// reported success
			expect(merged.contacts.map(c => c.name)).toEqual(broad.map(c => c.name))
			expect(merged.dropped).toBe(0)
		})
	})

	describe('when a second pass finds the title of somebody already named', () => {
		it('should put the title on the person rather than list them twice', () => {
			// GIVEN a Chinese name in both passes, the second carrying the title
			// WHEN merged
			// THEN one person with their title — the fold still does its own job
			const merged = mergeContacts(
				[{ name: '王小明' }],
				[{ name: '王小明', role: { value: '创始人' } }],
			)
			expect(merged.contacts).toHaveLength(1)
			expect(merged.contacts[0]?.role).toEqual({ value: '创始人' })
		})
	})

	describe('when several entries carry no name to key on', () => {
		it('should count them rather than let the list quietly shrink', () => {
			// GIVEN two entries whose names hold no letter or digit at all
			// WHEN merged
			// THEN neither is kept, neither absorbs the other, and the count says so
			const merged = mergeContacts(
				[{ name: '  ' }, { name: '—' }],
				[{ name: 'Ada' }],
			)
			expect(merged.contacts.map(c => c.name)).toEqual(['Ada'])
			expect(merged.dropped).toBe(2)
		})
	})
})
