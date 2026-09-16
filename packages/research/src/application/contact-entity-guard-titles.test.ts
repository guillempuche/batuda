import { describe, expect, it } from 'vitest'

import { bindScanContactsToRows } from './contact-entity-guard'

const contactsOn = (
	findings: unknown,
): ReadonlyArray<Record<string, unknown>> =>
	(
		findings as {
			prospects: ReadonlyArray<{
				contacts: ReadonlyArray<Record<string, unknown>>
			}>
		}
	).prospects[0]?.contacts ?? []

describe('bindScanContactsToRows, when a row’s person carries a label for a title', () => {
	it('should keep the person and drop the label, though the page carries it', () => {
		// GIVEN a directory line "Contact Diego Navarro" read as a person titled
		// "Contact", beside a colleague with a real post
		const findings = {
			prospects: [
				{
					name: 'Curtidos Badia',
					website: {
						value: 'https://curtidosbadia.com',
						source_id: 'https://curtidosbadia.com',
					},
					contacts: [
						{
							name: 'Diego Navarro',
							role: 'Contact',
							citations: [
								{
									quote: 'Contact Diego Navarro',
									source_id: 'https://curtidosbadia.com/contacto',
									confidence: 90,
								},
							],
						},
						{
							name: 'Xavier Badia',
							role: 'Director general',
							citations: [
								{
									quote: 'Xavier Badia, director general',
									source_id: 'https://curtidosbadia.com/empresa',
									confidence: 90,
								},
							],
						},
					],
				},
			],
		}

		// WHEN checked against the pages, which do carry the word "contact"
		const result = bindScanContactsToRows(
			findings,
			'prospects',
			'curtidos badia. contact diego navarro. xavier badia, director general.',
		)

		// THEN both people stay, the label goes and the post stands
		const kept = contactsOn(result.findings)
		expect(kept.map(c => c['name'])).toEqual(['Diego Navarro', 'Xavier Badia'])
		expect(kept[0]?.['role']).toBeUndefined()
		expect(kept[1]?.['role']).toBe('Director general')
		expect(result.droppedTitles).toBe(1)
	})
})
