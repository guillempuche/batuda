import { describe, expect, it } from 'vitest'

import { mergeContacts } from './contacts-rescue'

const OWN = 'https://acme.es/equipo'
const DIRECTORY = 'https://directory.example/acme'

describe('mergeContacts, when the same person carries a title from two pages', () => {
	describe('when the rescue pass read the title off the company’s own site', () => {
		it('should let the own-site title win over a directory’s', () => {
			// GIVEN the broad pass took the title from a directory and the rescue
			// pass from the company's team page
			const broad = [
				{ name: 'Ana Puig', role: { value: 'CEO', source_id: DIRECTORY } },
			]
			const rescued = [
				{ name: 'Ana Puig', role: { value: 'Gerent', source_id: OWN } },
			]

			// WHEN merged with the company's host known
			const merged = mergeContacts(broad, rescued, ['acme.es'])

			// THEN the team page's title stands
			expect(merged.contacts[0]?.role).toEqual({
				value: 'Gerent',
				source_id: OWN,
			})
		})

		it('should keep the broad title when both, or neither, sit on the own site', () => {
			// GIVEN two titles from the own site, and two from elsewhere
			const cases = [
				[OWN, 'https://acme.es/about'],
				[DIRECTORY, 'https://news.example/acme'],
			] as const

			for (const [first, second] of cases) {
				// WHEN merged
				const merged = mergeContacts(
					[{ name: 'Ana Puig', role: { value: 'CEO', source_id: first } }],
					[{ name: 'Ana Puig', role: { value: 'Gerent', source_id: second } }],
					['acme.es'],
				)
				// THEN the first-seen title stands
				expect(merged.contacts[0]?.role, first).toEqual({
					value: 'CEO',
					source_id: first,
				})
			}
		})

		it('should read a subdomain as the own site and a look-alike as not', () => {
			// GIVEN a title from careers.acme.es and one from acme.es.example
			const merged = mergeContacts(
				[
					{
						name: 'Ana Puig',
						role: { value: 'CEO', source_id: 'https://acme.es.example/a' },
					},
				],
				[
					{
						name: 'Ana Puig',
						role: { value: 'Gerent', source_id: 'https://careers.acme.es/t' },
					},
				],
				['acme.es'],
			)

			// THEN the subdomain's title wins
			expect(merged.contacts[0]?.role).toMatchObject({ value: 'Gerent' })
		})
	})

	describe('when the broad pass left the rendering null', () => {
		it('should fill it from the rescue pass all the same', () => {
			// GIVEN a null rendering on the broad side and a real one on the rescue side
			const merged = mergeContacts(
				[{ name: 'Ana Puig', role: { value: 'Gerent', gloss: null } }],
				[{ name: 'Ana Puig', role: { value: 'Gerent', gloss: 'Manager' } }],
			)

			// THEN the rendering lands
			expect(merged.contacts[0]?.role).toEqual({
				value: 'Gerent',
				gloss: 'Manager',
			})
		})
	})
})
