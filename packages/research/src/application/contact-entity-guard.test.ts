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
	const person = (
		name: string,
		quote: string,
		source = 'https://example.com',
	) => ({
		name,
		citations: [{ quote, source_id: source, confidence: 90 }],
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

	describe('when a job title ends in a word companies are named after', () => {
		it('should keep the employee rather than read the title as an employer', () => {
			// GIVEN real staff whose titles end in Services, Solutions and Systems —
			// the same words that end a company name
			const findings = {
				prospects: [
					row('Talleres Vidal SL', [
						person('Anna Serra', 'Anna Serra, Director of Client Services'),
						person('Pau Mas', 'Pau Mas, Head of Technical Solutions'),
						person('Ona Vila', 'Ona Vila, VP Business Systems'),
					]),
				],
			}

			// WHEN each row's people are held against that row
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN all three stay: none of those quotes names another employer
			expect(result.dropped).toBe(0)
			expect(contactsOn(result.findings, 0)).toHaveLength(3)
		})
	})

	describe('when a stranger works for another firm in the same trade', () => {
		it('should drop them, because a trade word tells two companies apart', () => {
			// GIVEN a client quoted on the row's own page, whose company shares only
			// the trade word — the shape of nearly every name in this market
			const findings = {
				prospects: [
					row('Transportes Ribera SL', [
						person(
							'Marta Gomez',
							'Marta Gomez, directora de Transportes Gomez SL, cliente nuestro.',
						),
					]),
				],
			}

			// WHEN checked
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN the client goes: "Transportes" is what both are, not who either is
			expect(result.dropped).toBe(1)
			expect(contactsOn(result.findings, 0)).toEqual([])
		})
	})

	describe('when a row is listed under a legal name its staff never use', () => {
		it('should keep them, because the row gave the address they are quoted on', () => {
			// GIVEN a registry-shaped row whose own team page calls the firm
			// something else entirely, with only the website tying the two
			const findings = {
				prospects: [
					{
						name: 'Especialidades Geotecnicas e Ingenieria SL',
						website: {
							value: 'https://egein.com',
							source_id: 'https://egein.com',
						},
						contacts: [
							person(
								'David Garrido',
								'David Garrido, CEO at Egein Group',
								'https://egein.com/equip',
							),
						],
					},
				],
			}

			// WHEN checked
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN the CEO stays on his own company's row
			expect(result.dropped).toBe(0)
			expect(contactsOn(result.findings, 0)).toHaveLength(1)
		})
	})

	describe('when nothing is left saying where a person was read', () => {
		it('should drop them and count it apart from a misfiling', () => {
			// GIVEN one person the citation guard emptied and one it left alone
			const findings = {
				prospects: [
					row('Talleres Vidal SL', [
						{ name: 'Ghost Name', citations: [] },
						person('Anna Serra', 'Anna Serra, Gerent'),
					]),
				],
			}

			// WHEN checked
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN the unsourced one goes, under its own count
			expect(result.droppedUncited).toBe(1)
			expect(result.dropped).toBe(0)
			expect(contactsOn(result.findings, 0)).toHaveLength(1)
		})
	})

	describe('when the employer follows a comma or opens the sentence', () => {
		it('should still read it as an employer', () => {
			// GIVEN the two shapes press and testimonial copy actually use, neither
			// of which puts a word in front placing anybody anywhere
			const findings = {
				prospects: [
					row('Talleres Vidal SL', [
						person(
							'Mark Riskowitz',
							'Mark Riskowitz, VP of Operations, Caraway Logistics',
						),
					]),
					row('Talleres Vidal SL', [
						person(
							'Andrew Smith',
							'Caraway Logistics promotes Andrew Smith to SVP',
						),
					]),
				],
			}

			// WHEN each row's people are held against that row
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN both go: asking every quote for a placing word lost exactly these
			expect(result.dropped).toBe(2)
		})
	})

	describe('when a row is named after nothing but its trade', () => {
		it('should keep its own staff and still refuse an unsourced one', () => {
			// GIVEN a company whose every word is the trade, with an address of its
			// own — so the check runs, but has no word to decide with
			const findings = {
				prospects: [
					{
						name: 'Transportes y Logistica SL',
						website: {
							value: 'https://transportesylogistica.es',
							source_id: 'https://transportesylogistica.es',
						},
						contacts: [
							person(
								'Juan Perez',
								'Juan Perez, Gerente de Transportes y Logistica SL',
								'https://transportesylogistica.es/equip',
							),
							{ name: 'Ghost Name', citations: [] },
						],
					},
				],
			}

			// WHEN checked
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN the gerente stays — nothing here tells one haulier from another —
			// while the one with no evidence at all still goes
			expect(result.dropped).toBe(0)
			expect(result.droppedUncited).toBe(1)
			expect(
				(contactsOn(result.findings, 0) as ReadonlyArray<{ name: string }>)[0]
					?.name,
			).toBe('Juan Perez')
		})
	})

	describe('when a trade-only row has no address either', () => {
		it('should still refuse a person with nothing behind them', () => {
			// GIVEN a row that can decide nothing about whose staff anybody is
			const findings = {
				prospects: [
					row('Transportes y Logistica SL', [{ name: 'Ghost', citations: [] }]),
				],
			}

			// WHEN checked — THEN whether a person came with any evidence is not a
			// question about the row, so it is asked anyway
			expect(bindScanContactsToRows(findings, 'prospects').droppedUncited).toBe(
				1,
			)
		})
	})

	describe('when only a directory about the company names a person', () => {
		it('should refuse them, because a roster nobody owns goes stale', () => {
			// GIVEN the shape a real scan returned: two people read off an
			// aggregator's employee page, beside one read on the company's own site
			const findings = {
				prospects: [
					{
						name: 'Serxar',
						website: {
							value: 'https://www.serxar.com/',
							source_id: 'https://www.serxar.com/',
						},
						contacts: [
							person(
								'Gerard Batlle',
								'Gerard Batlle, Adjunto Direccion',
								'https://rocketreach.co/serxar-sau-employees',
							),
							person(
								'Anna Martinez',
								"Anna Martinez, Cap d'Obra",
								'https://rocketreach.co/serxar-sau-employees',
							),
							person(
								'Marta Roca',
								'Marta Roca, Gerent',
								'https://www.serxar.com/en/about-us',
							),
						],
					},
				],
			}

			// WHEN checked
			const result = bindScanContactsToRows(findings, 'prospects')

			// THEN only the one the company itself names survives
			expect(result.droppedOffSite).toBe(2)
			expect(
				(contactsOn(result.findings, 0) as ReadonlyArray<{ name: string }>).map(
					c => c.name,
				),
			).toEqual(['Marta Roca'])
		})
	})

	describe('when a row gave no address of its own', () => {
		it('should keep a person read anywhere, having no way to tell', () => {
			// GIVEN a company with no website on the row, so nothing separates its
			// own pages from a page about it
			const findings = {
				prospects: [
					row('Talleres Vidal SL', [
						person(
							'Marta Roca',
							'Marta Roca, Gerent',
							'https://rocketreach.co/talleres-vidal',
						),
					]),
				],
			}

			// WHEN checked — THEN nobody goes: a rule that cannot tell the two
			// apart must not act as though it can
			expect(bindScanContactsToRows(findings, 'prospects').droppedOffSite).toBe(
				0,
			)
		})
	})

	describe('when a title appears on no page the run read', () => {
		it('should take the title and keep the person', () => {
			// GIVEN the shape a real scan returned, where the model wrote its own
			// uncertainty into the title rather than leaving it out
			const findings = {
				prospects: [
					row('Bellmas Enginyers SL', [
						{
							name: 'Laura Bellmas',
							role: 'Director/a (assumptiu – la pagina no indica el titol exacte)',
							citations: [
								{
									quote: 'Laura Bellmas',
									source_id: 'https://example.com',
									confidence: 90,
								},
							],
						},
					]),
				],
			}

			// WHEN checked against the pages the run actually read
			const result = bindScanContactsToRows(
				findings,
				'prospects',
				'Bellmas Enginyers Associats. Laura Bellmas. Contacte.',
			)

			// THEN she stays and the invented title goes: a made-up title is worse
			// than none, because it is what somebody opens a call with
			expect(result.droppedTitles).toBe(1)
			const kept = contactsOn(result.findings, 0) as ReadonlyArray<
				Record<string, unknown>
			>
			expect(kept).toHaveLength(1)
			expect(kept[0]?.['name']).toBe('Laura Bellmas')
			expect(kept[0]?.['role']).toBeUndefined()
		})
	})

	describe('when a title is an acronym no page the run read writes', () => {
		it('should take it off, since an acronym is the whole of what a model may have made up', () => {
			// GIVEN a person titled "CEO" whose pages name them but never the title
			const findings = {
				prospects: [
					row('Egein', [
						{
							name: 'David Garrido',
							role: 'CEO',
							citations: [
								{
									quote: 'David Garrido',
									source_id: 'https://example.com',
									confidence: 90,
								},
							],
						},
					]),
				],
			}

			// WHEN checked against a corpus that names the person and not the title
			const result = bindScanContactsToRows(
				findings,
				'prospects',
				'David Garrido leads the Egein team in Girona',
			)

			// THEN the title goes and the person stays
			expect(result.droppedTitles).toBe(1)
		})
	})

	describe('when a title is written on a page the run read', () => {
		it('should keep it', () => {
			// GIVEN a title copied verbatim off the team page
			const findings = {
				prospects: [
					row('Egein', [
						{
							name: 'David Garrido',
							role: 'CEO - Enginyer Industrial',
							citations: [
								{
									quote: 'David Garrido',
									source_id: 'https://example.com',
									confidence: 90,
								},
							],
						},
					]),
				],
			}

			// WHEN checked against a corpus that states it
			const result = bindScanContactsToRows(
				findings,
				'prospects',
				'David Garrido CEO - Enginyer Industrial Mariona Garrido CFO',
			)

			// THEN nothing is taken away
			expect(result.droppedTitles).toBe(0)
		})
	})

	describe('when the run read no pages at all', () => {
		it('should leave every title alone rather than judge against nothing', () => {
			// GIVEN no corpus to check against
			const findings = {
				prospects: [
					row('Egein', [
						{
							name: 'David Garrido',
							role: 'CEO',
							citations: [
								{
									quote: 'x',
									source_id: 'https://example.com',
									confidence: 90,
								},
							],
						},
					]),
				],
			}

			// WHEN checked with nothing behind it — THEN the title stays
			expect(bindScanContactsToRows(findings, 'prospects').droppedTitles).toBe(
				0,
			)
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
