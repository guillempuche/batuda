import { describe, expect, it } from 'vitest'

import { teamPagesForRows } from './scan-team-pages'

const never = () => false

describe('teamPagesForRows', () => {
	describe('when a company came back with no people and links a team page', () => {
		it('should pick that page', () => {
			// GIVEN a company the run found, whose own site links an "equip" page
			const picked = teamPagesForRows({
				findings: {
					prospects: [
						{
							name: 'Egein',
							website: { value: 'https://egein.com', source_id: 'x' },
							contacts: [],
						},
					],
				},
				listField: 'prospects',
				addresses: [
					'https://egein.com/ca/serveis',
					'https://egein.com/ca/equip',
					'https://egein.com/ca/contacte',
				],
				alreadyTried: never,
				max: 3,
			})

			// THEN the team page is chosen over the services and contact pages
			expect(picked).toEqual([
				{ name: 'Egein', url: 'https://egein.com/ca/equip' },
			])
		})
	})

	describe('when the company already named somebody', () => {
		it('should pass it over', () => {
			// GIVEN a row that already carries a person
			const picked = teamPagesForRows({
				findings: {
					prospects: [
						{
							name: 'Egein',
							website: { value: 'https://egein.com', source_id: 'x' },
							contacts: [{ name: 'David Garrido' }],
						},
					],
				},
				listField: 'prospects',
				addresses: ['https://egein.com/ca/equip'],
				alreadyTried: never,
				max: 3,
			})

			// THEN nothing is bought for it: the round's money goes to a company
			// that came back with nobody
			expect(picked).toEqual([])
		})
	})

	describe('when the run never saw a link to the company own pages', () => {
		it('should pass it over rather than guess a path', () => {
			// GIVEN a company whose site the run only knows the address of
			const picked = teamPagesForRows({
				findings: {
					prospects: [
						{
							name: 'Talleres Vidal SL',
							website: { value: 'https://talleresvidal.es', source_id: 'x' },
							contacts: [],
						},
					],
				},
				listField: 'prospects',
				addresses: ['https://otro.es/equipo'],
				alreadyTried: never,
				max: 3,
			})

			// THEN nothing: a guessed path is a fetch into a 404
			expect(picked).toEqual([])
		})
	})

	describe('when a row gave no address at all', () => {
		it('should pass it over', () => {
			expect(
				teamPagesForRows({
					findings: { prospects: [{ name: 'Sense Web', contacts: [] }] },
					listField: 'prospects',
					addresses: ['https://egein.com/ca/equip'],
					alreadyTried: never,
					max: 3,
				}),
			).toEqual([])
		})
	})

	describe('when the best page was already fetched', () => {
		it('should take the next one rather than pay for it twice', () => {
			// GIVEN the team page already read this run
			const picked = teamPagesForRows({
				findings: {
					prospects: [
						{
							name: 'Egein',
							website: { value: 'https://egein.com', source_id: 'x' },
							contacts: [],
						},
					],
				},
				listField: 'prospects',
				addresses: [
					'https://egein.com/ca/equip',
					'https://egein.com/ca/empresa',
				],
				alreadyTried: url => url === 'https://egein.com/ca/equip',
				max: 3,
			})

			// THEN the about page stands in for it
			expect(picked).toEqual([
				{ name: 'Egein', url: 'https://egein.com/ca/empresa' },
			])
		})
	})

	describe('when more companies want a page than the round can afford', () => {
		it('should stop at what it was given', () => {
			// GIVEN three companies with nobody named and a budget for one
			const picked = teamPagesForRows({
				findings: {
					prospects: [
						{ name: 'A', website: 'https://a.es', contacts: [] },
						{ name: 'B', website: 'https://b.es', contacts: [] },
						{ name: 'C', website: 'https://c.es', contacts: [] },
					],
				},
				listField: 'prospects',
				addresses: [
					'https://a.es/equip',
					'https://b.es/equip',
					'https://c.es/equip',
				],
				alreadyTried: never,
				max: 1,
			})

			// THEN one, so a long list cannot spend the whole purse on people
			expect(picked).toHaveLength(1)
		})
	})

	describe('when the only page a company links is a contact form', () => {
		it('should buy nothing, rather than pay to meet a switchboard', () => {
			// GIVEN a company whose site links a contact page and nothing else
			const picked = teamPagesForRows({
				findings: {
					prospects: [
						{
							name: 'ER Enginy',
							website: { value: 'https://erenginy.com', source_id: 'x' },
							contacts: [],
						},
					],
				},
				listField: 'prospects',
				addresses: ['https://erenginy.com/en/contact/'],
				alreadyTried: never,
				max: 3,
			})

			// THEN nothing is fetched: this sweep is looking for the people, and a
			// real search opened exactly this page and came back with nobody
			expect(picked).toEqual([])
		})
	})

	describe('when the run is not a search', () => {
		it('should return nothing', () => {
			expect(
				teamPagesForRows({
					findings: { contacts: [] },
					listField: undefined,
					addresses: ['https://egein.com/ca/equip'],
					alreadyTried: never,
					max: 3,
				}),
			).toEqual([])
		})
	})
})
