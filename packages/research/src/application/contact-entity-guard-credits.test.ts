import { describe, expect, it } from 'vitest'

import {
	bindContactsToEntity,
	bindScanContactsToRows,
} from './contact-entity-guard'
import { isSiteCreditLine, readsAsSiteCredit } from './contact-name'

const TARGETS = {
	cores: ['verpack'],
	words: ['verpack'],
	domains: ['verpack.fr'],
	places: [],
}
const LEGAL = 'https://www.verpack.fr/mentions-legales'
const names = (findings: unknown): ReadonlyArray<string> =>
	(findings as { contacts: Array<{ name: string }> }).contacts.map(c => c.name)

describe('readsAsSiteCredit, over the labels a legal notice puts beside a name', () => {
	it('should read the credits in several languages and no post', () => {
		// GIVEN the credits seen stored as job titles, with accents and case
		for (const label of [
			'Photographie',
			'Développement',
			'Webdesign',
			'Vidéo',
			'diseño web',
		]) {
			expect(readsAsSiteCredit(label), label).toBe(true)
		}
		// AND real posts, including ones a credit word could be mistaken for
		for (const label of [
			'Président',
			'Head of Design',
			'Development Director',
			'Sales',
		]) {
			expect(readsAsSiteCredit(label), label).toBe(false)
		}
	})
})

describe('isSiteCreditLine, over the lines that name a person', () => {
	it('should read a credit label beside the name and nothing else as a credit', () => {
		// GIVEN a credit line and a line that says more
		expect(
			isSiteCreditLine('Photographie Thierry Laroche', 'Thierry Laroche'),
		).toBe(true)
		expect(
			isSiteCreditLine('Webdesign : Patrick Mirété', 'Patrick Mirété'),
		).toBe(true)
		expect(
			isSiteCreditLine(
				'Directeur de publication : Stéphane Viers, Président',
				'Stéphane Viers',
			),
		).toBe(false)
		// AND a line that does not name the person is no credit line
		expect(isSiteCreditLine('Photographie', 'Thierry Laroche')).toBe(false)
	})
})

describe('bindContactsToEntity, when a legal notice credits the people who made the site', () => {
	it('should drop them, with or without the credit as their title, and keep the president', () => {
		// GIVEN the president, a photographer titled by his credit and a web
		// designer with no title whose only lines are credits
		const findings = {
			contacts: [
				{
					name: 'Stéphane Viers',
					role: 'Président',
					citations: [
						{
							quote: 'Directeur de publication : Stéphane Viers, Président',
							source_id: LEGAL,
						},
					],
				},
				{
					name: 'Bernard Rouffignac',
					role: 'Photographie',
					citations: [
						{ quote: 'Photographie Bernard Rouffignac', source_id: LEGAL },
					],
				},
				{
					name: 'Patrick Mirété',
					role: null,
					citations: [
						{ quote: 'Photographie Patrick Mirété', source_id: LEGAL },
						{ quote: 'Webdesign Patrick Mirété', source_id: LEGAL },
					],
				},
			],
		}
		// WHEN bound to the company
		const result = bindContactsToEntity(findings, TARGETS)
		// THEN only the president stays, and the credits are counted apart
		expect(names(result.findings)).toEqual(['Stéphane Viers'])
		expect(result.droppedSiteCredit).toBe(2)
		expect(result.droppedNotPerson).toBe(0)
	})

	it('should drop a credit whose title arrived paired with its page', () => {
		// GIVEN the title written in the shape a run pairs a value with its page
		const findings = {
			contacts: [
				{
					name: 'Patrick Mirété',
					role: { value: 'Webdesign', source_id: LEGAL },
					citations: [
						{ quote: 'Webdesign : Patrick Mirété', source_id: LEGAL },
					],
				},
			],
		}
		// WHEN bound to the company
		const result = bindContactsToEntity(findings, TARGETS)
		// THEN the credit is read through the wrapper
		expect(names(result.findings)).toEqual([])
		expect(result.droppedSiteCredit).toBe(1)
	})

	it('should keep a person with no title whose lines quote nothing', () => {
		// GIVEN a person cited to a page with no words copied from it, so there is
		// no line to read as a credit
		const findings = {
			contacts: [
				{ name: 'Marie Dupont', role: null, citations: [{ source_id: LEGAL }] },
			],
		}
		// WHEN bound
		const result = bindContactsToEntity(findings, TARGETS)
		// THEN she stays: nothing here says she made the site
		expect(names(result.findings)).toEqual(['Marie Dupont'])
		expect(result.droppedSiteCredit).toBe(0)
	})

	it('should keep a person with no title whose lines say more than a credit', () => {
		// GIVEN a person cited once as a credit and once in a sentence
		const findings = {
			contacts: [
				{
					name: 'Marie Dupont',
					citations: [
						{ quote: 'Photographie Marie Dupont', source_id: LEGAL },
						{
							quote: 'Marie Dupont dirige le site de Bordeaux',
							source_id: LEGAL,
						},
					],
				},
			],
		}
		// WHEN bound
		const result = bindContactsToEntity(findings, TARGETS)
		// THEN she stays
		expect(names(result.findings)).toEqual(['Marie Dupont'])
		expect(result.droppedSiteCredit).toBe(0)
	})

	it('should drop a credit even when the run has no company to hold people against', () => {
		// GIVEN no entity targets
		const findings = {
			contacts: [
				{
					name: 'Bernard Rouffignac',
					role: 'Photographie',
					citations: [
						{ quote: 'Photographie Bernard Rouffignac', source_id: LEGAL },
					],
				},
				{
					name: 'Ana Puig',
					role: 'CEO',
					citations: [{ quote: 'Ana Puig, CEO', source_id: LEGAL }],
				},
			],
		}
		// WHEN bound with null targets
		const result = bindContactsToEntity(findings, null)
		// THEN the credit goes and the rest pass through unjudged
		expect(names(result.findings)).toEqual(['Ana Puig'])
		expect(result.droppedSiteCredit).toBe(1)
		expect(result.dropped).toBe(0)
	})
})

describe('bindContactsToEntity, when a credit word is a post on a team page', () => {
	it('should keep the person: only a legal notice credits the makers of the site', () => {
		// GIVEN a studio's own team page naming its web designer and its
		// developer by their posts
		const findings = {
			contacts: [
				{
					name: 'Marta Roig',
					role: 'Disseny web',
					citations: [
						{
							quote: 'Marta Roig — Disseny web',
							source_id: 'https://studio.cat/equip',
						},
					],
				},
				{
					name: 'Marc Vidal',
					role: 'Development',
					citations: [
						{
							quote: 'Development Marc Vidal',
							source_id: 'https://studio.cat/equip',
						},
						{ quote: 'Development Marc Vidal', source_id: LEGAL },
					],
				},
			],
		}
		// WHEN bound to the company
		const result = bindContactsToEntity(findings, TARGETS)
		// THEN both stay, and the findings are handed back as they were
		expect(names(result.findings)).toEqual(['Marta Roig', 'Marc Vidal'])
		expect(result.droppedSiteCredit).toBe(0)
		expect(result.findings).toBe(findings)
	})
})

describe('bindScanContactsToRows, when a scan row lists the site credits as people', () => {
	it('should drop the credited person and keep the founder', () => {
		// GIVEN a row with a founder and a photographer
		const findings = {
			prospects: [
				{
					name: 'Verpack',
					website: 'https://www.verpack.fr',
					contacts: [
						{
							name: 'Stéphane Viers',
							role: 'Président',
							citations: [
								{ quote: 'Stéphane Viers, Président', source_id: LEGAL },
							],
						},
						{
							name: 'Bernard Rouffignac',
							role: 'Photographie',
							citations: [
								{ quote: 'Photographie Bernard Rouffignac', source_id: LEGAL },
							],
						},
					],
				},
			],
		}
		// WHEN bound to the rows
		const result = bindScanContactsToRows(
			findings,
			'prospects',
			'stéphane viers, président. photographie bernard rouffignac',
		)
		// THEN the photographer goes, counted as a credit
		const row = (
			result.findings as {
				prospects: Array<{ contacts: Array<{ name: string }> }>
			}
		).prospects[0]
		expect(row?.contacts.map(c => c.name)).toEqual(['Stéphane Viers'])
		expect(result.droppedSiteCredit).toBe(1)
	})
})
