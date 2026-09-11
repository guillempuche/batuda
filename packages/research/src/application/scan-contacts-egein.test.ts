import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { bindScanContactsToRows } from './contact-entity-guard'
import { buildExtractionPrompt } from './research-service'
import { ProspectScanV1Schema } from './schemas/prospect-scan-v1'

/**
 * The run that found EGEIN fetched its team page and returned nobody.
 *
 * `egein.com/ca/equip` is in that run's stored sources, and it names 42 people
 * with their titles. The row had no field for them and the extraction step was
 * never asked, so all 42 were dropped. These hold every part of that path open
 * except the model's own compliance, which needs a live extract call.
 */

// Read off the page as the run stored it, names and titles verbatim.
const EGEIN_PEOPLE = [
	{ name: 'David Garrido', role: 'CEO - Enginyer Industrial' },
	{
		name: 'Mariona Garrido',
		role: 'CFO - Direcció Financera i Recursos Humans',
	},
	{ name: 'Rafel Alum', role: 'Enginyer industrial - BIM Manager' },
	{ name: 'Jesús Muñoz', role: 'Controller Financer' },
	{ name: 'Alexis Aguilar', role: "Cap d'obres - Arquitecte" },
]

const egeinRow = (contacts: ReadonlyArray<unknown>) => ({
	name: "Enginyeria I Gestió D'Espais Industrials SL",
	website: {
		value: 'https://egein.com',
		source_id: 'https://egein.com/ca',
		confidence: 0.9,
	},
	why_relevant: 'Engineering and turnkey construction of industrial buildings.',
	citations: [
		{
			quote: 'EGEIN',
			source_id: 'https://egein.com/ca/equip',
			confidence: 100,
		},
	],
	contacts,
})

const withCitations = (people: ReadonlyArray<{ name: string; role: string }>) =>
	people.map(p => ({
		...p,
		citations: [
			{
				quote: p.role,
				source_id: 'https://egein.com/ca/equip',
				confidence: 90,
			},
		],
	}))

describe('what a company search does with a team page it fetched', () => {
	describe('when the run is a search for companies', () => {
		it('should ask the extraction step for each company own people', () => {
			// GIVEN the prompt the extraction step is actually given for a search
			const prompt = buildExtractionPrompt({
				query: "Empreses d'enginyeria industrial a Girona",
				citationInstruction: '',
				evidenceBlock: '',
				subjects: [],
				discoveryScan: true,
			})

			// WHEN it is read — THEN it asks for people, and says they belong to the
			// company they work for rather than to a list of their own. Without this
			// the run fetched EGEIN's team page and reported nobody.
			expect(prompt).toContain('`contacts`')
			expect(prompt).toMatch(/leader or employee/i)
			expect(prompt).toMatch(/under the company they work for/i)
		})

		it('should not ask a run about one company for the same thing', () => {
			// GIVEN the prompt for a run whose whole job is a single company, which
			// keeps its people in a list of its own
			const prompt = buildExtractionPrompt({
				query: 'EGEIN',
				citationInstruction: '',
				evidenceBlock: '',
				subjects: [],
				discoveryScan: false,
			})

			// WHEN read — THEN it gets the people ask it always had, unchanged
			expect(prompt).toContain('Name EVERY person')
		})
	})

	describe('when the answer carries the people that page named', () => {
		it('should be a shape the schema accepts', () => {
			// GIVEN an answer holding EGEIN with five of its named staff
			const decoded = Schema.decodeUnknownSync(ProspectScanV1Schema)({
				prospects: [egeinRow(withCitations(EGEIN_PEOPLE))],
			})

			// WHEN decoded — THEN every person survives with their title, so what the
			// page said reaches the findings rather than being dropped at the door
			const people = decoded.prospects[0]?.contacts ?? []
			expect(people).toHaveLength(5)
			expect(people.map(p => p.name)).toContain('Mariona Garrido')
			expect(people.find(p => p.name === 'David Garrido')?.role).toBe(
				'CEO - Enginyer Industrial',
			)
		})

		it('should keep them on EGEIN rather than the company listed beside it', () => {
			// GIVEN EGEIN's own staff on EGEIN's row, and a second company whose row
			// carries somebody the evidence ties to EGEIN instead
			const findings = {
				prospects: [
					egeinRow(withCitations(EGEIN_PEOPLE)),
					{
						name: 'Calderería Empordà SL',
						citations: [],
						contacts: [
							{
								name: 'David Garrido',
								role: 'CEO',
								citations: [
									{
										quote: 'David Garrido, CEO at Egein Group',
										source_id: 'https://egein.com/ca/equip',
										confidence: 90,
									},
								],
							},
						],
					},
				],
			}

			// WHEN each row's people are held against that row
			const result = bindScanContactsToRows(findings, 'prospects')
			const rows = (
				result.findings as {
					prospects: ReadonlyArray<{ contacts: ReadonlyArray<unknown> }>
				}
			).prospects

			// THEN EGEIN keeps its own and the misfiled one goes, which is the
			// mistake a page naming many firms makes easiest
			expect(rows[0]?.contacts).toHaveLength(5)
			expect(rows[1]?.contacts).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})
})
