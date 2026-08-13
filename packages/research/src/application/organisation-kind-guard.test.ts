import { describe, expect, it } from 'vitest'

import { dropNonCompanies } from './organisation-kind-guard'

// A scan's answer: the list of organisations it came back with.
const scan = (
	prospects: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> => ({ prospects })

const namesOf = (findings: unknown): Array<unknown> =>
	(findings as { prospects: Array<{ name?: unknown }> }).prospects.map(
		row => row.name,
	)

describe('dropNonCompanies', () => {
	describe('when a row names itself as a body of another kind', () => {
		it('should drop a trade association that says so in its own name', () => {
			// GIVEN a list holding a real installer and the association that lists it
			const findings = scan([
				{ name: 'Electricidad Mora SL', why_relevant: 'Installer in Ourense.' },
				{
					name: 'Asociación Provincial de Instaladores Eléctricos de Ourense',
					why_relevant: 'Matches the sector and the province asked for.',
				},
			])

			// WHEN the kinds are checked
			// THEN the body goes and the company stays, with the words that decided it
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['Electricidad Mora SL'])
			expect(result.dropped).toEqual([
				{
					name: 'Asociación Provincial de Instaladores Eléctricos de Ourense',
					kind: 'asociacion',
				},
			])
		})

		it('should drop a body that says what it is in its rationale', () => {
			// GIVEN a row whose name gives nothing away but whose rationale opens with
			// what the organisation is
			const findings = scan([
				{
					name: 'AEMIAT',
					why_relevant:
						'Regional association representing 212 installation companies.',
				},
			])

			// WHEN checked — THEN the rationale is enough on its own
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([])
			expect(result.dropped[0]?.kind).toBe('association')
		})

		it('should drop a kind that only a phrase pins down', () => {
			// GIVEN the grid operator, which no single word identifies
			const findings = scan([
				{
					name: 'Red Eléctrica de España',
					why_relevant: 'Operador del sistema eléctrico (TSO).',
				},
			])

			// WHEN checked — THEN the run of words is matched, not "operador" alone
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([])
			expect(result.dropped[0]?.kind).toBe('operador del sistema')
		})

		it('should drop a body filed under a trade that names the kind', () => {
			// GIVEN a row that says what it is only in its industry
			const findings = scan([
				{
					name: 'FENIE',
					industry: 'Federación nacional de empresarios de instalaciones',
					why_relevant: 'Covers the whole of the sector asked about.',
				},
			])

			// WHEN checked — THEN the trade is read the same way the rationale is
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([])
			expect(result.dropped[0]?.kind).toBe('federacion')
		})

		it('should read a plural and an accent the same as the singular form', () => {
			// GIVEN the same kinds written in the plural, and with the accents a
			// Spanish page prints
			const findings = scan([
				{ name: 'Confederación Española de Gremios', why_relevant: 'Sector.' },
				{ name: 'Unión de Asociaciones de Instaladores', why_relevant: 'Sec.' },
			])

			// WHEN checked — THEN both go: folding happens before the words are read
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([])
		})

		it('should read a Catalan name whose word carries an interpunct', () => {
			// GIVEN "Col·legi Oficial", where the dot sits inside the word
			const findings = scan([
				{
					name: "Col·legi Oficial d'Enginyers Tècnics",
					why_relevant: 'Professional body for the trade.',
				},
			])

			// WHEN checked — THEN the punctuation inside the word is removed rather
			// than split on, so the phrase still reads as one
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([])
			expect(result.dropped[0]?.kind).toBe('collegi oficial')
		})
	})

	describe('when a row only mentions a body it belongs to', () => {
		it('should keep a company introduced as a member of one', () => {
			// GIVEN an installer whose rationale names the association it belongs to
			const findings = scan([
				{
					name: 'Instalaciones Ruiz SL',
					why_relevant:
						'Miembro de la Asociación de Instaladores de Ourense; 14 empleados.',
				},
			])

			// WHEN checked — THEN the membership word governs what follows it, so this
			// says who it belongs to, not what it is
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['Instalaciones Ruiz SL'])
			expect(result.dropped).toEqual([])
		})

		it('should keep a company whose membership is written the long way round', () => {
			// GIVEN the longest ordinary way of saying it, with four words in between
			const findings = scan([
				{
					name: 'Montajes Tejero',
					why_relevant: 'Member of the Spanish association of installers.',
				},
			])

			// WHEN checked — THEN the lookback still reaches the membership word
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['Montajes Tejero'])
		})

		it('should keep a company whose own name says it is a member', () => {
			// GIVEN a membership word inside the name itself
			const findings = scan([
				{
					name: 'Instalaciones Ruiz, miembro de la Asociación Gallega',
					why_relevant: 'Installer in Ourense.',
				},
			])

			// WHEN checked — THEN the name is read the same way the rationale is
			const result = dropNonCompanies(findings, 'prospects')
			expect(result.dropped).toEqual([])
		})

		it('should keep a company that took a body word for its brand', () => {
			// GIVEN companies whose trading name borrows the word — a taberna, a
			// software house — with no trade after it to cover
			const findings = scan([
				{ name: 'El Gremio Taberna SL', why_relevant: 'Bar in Madrid.' },
				{ name: 'Guild Software Ltd', why_relevant: 'Software vendor.' },
			])

			// WHEN checked
			// THEN both stay. A body's name gives the trade it covers — "Gremio de
			// Instaladores" — and a company that merely liked the word names none,
			// because it is not covering one
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([
				'El Gremio Taberna SL',
				'Guild Software Ltd',
			])
		})

		it('should keep a company a body word only describes', () => {
			// GIVEN a description where the word modifies what follows it
			const findings = scan([
				{
					name: 'Instalaciones Vega',
					description: 'Association-backed installer with 30 staff.',
				},
			])

			// WHEN checked — THEN it stays: an association-backed installer is an
			// installer, and the word is describing the next one, not the organisation
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['Instalaciones Vega'])
		})

		it('should keep a company whose name merely looks like a membership word', () => {
			// GIVEN "Asociados", what a partnership calls itself — not "Asociación"
			const findings = scan([
				{ name: 'García y Asociados SL', why_relevant: 'Electrical fitter.' },
			])

			// WHEN checked — THEN each spelling is listed rather than matched by its
			// opening, so a member's own word never reads as the body
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['García y Asociados SL'])
		})

		it('should keep a company that gets to the body only late in its rationale', () => {
			// GIVEN a company that says what it does first and mentions the sector body
			// well after
			const findings = scan([
				{
					name: 'Electro Vigo',
					why_relevant:
						'Instaladora eléctrica de Vigo con 12 empleados que colabora con la asociación del sector.',
				},
			])

			// WHEN checked — THEN only the opening of a rationale settles the kind: a
			// body leads with what it is, a company gets there afterwards
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['Electro Vigo'])
		})
	})

	describe('when a row says nothing about its kind', () => {
		it('should keep a company the run could not confirm', () => {
			// GIVEN a thinly-documented small firm the run marked as a candidate
			const findings = scan([
				{
					name: 'Instalaciones Barreiro',
					why_relevant: 'Named on a municipal tender list.',
					unconfirmed_reason: 'No website or register entry found.',
				},
			])

			// WHEN checked
			// THEN it stays: not being able to prove a company exists is not proof it
			// does not, and only a stated kind is ever a reason to drop
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual(['Instalaciones Barreiro'])
			expect(result.dropped).toEqual([])
		})

		it('should keep a row whose only clue is a word that means something else', () => {
			// GIVEN "cámara", which is refrigeration equipment far more often than it
			// is a chamber of commerce
			const findings = scan([
				{ name: 'Cámaras Frigoríficas del Norte', why_relevant: 'Cold rooms.' },
			])

			// WHEN checked — THEN the word alone is not enough; only the full phrase is
			const result = dropNonCompanies(findings, 'prospects')
			expect(namesOf(result.findings)).toEqual([
				'Cámaras Frigoríficas del Norte',
			])
		})

		it('should keep a row with no name and no rationale at all', () => {
			// GIVEN a row the model returned all but empty
			const findings = scan([{ citations: [] }])

			// WHEN checked — THEN there is nothing stated to drop it on
			const result = dropNonCompanies(findings, 'prospects')
			expect(result.dropped).toEqual([])
			expect(
				(result.findings as { prospects: Array<unknown> }).prospects,
			).toHaveLength(1)
		})
	})

	describe('when the answer is not a list of organisations', () => {
		it('should pass a run through untouched when it has no list', () => {
			// GIVEN a run about one named company, which was told who to research
			const findings = { enrichment: { industry: 'Asociación profesional' } }

			// WHEN checked with no list field
			// THEN nothing is read and nothing is dropped
			const result = dropNonCompanies(findings, undefined)
			expect(result.findings).toBe(findings)
			expect(result.dropped).toEqual([])
		})

		it('should read a competitor list the same way as a prospect list', () => {
			// GIVEN the other scan schema's list, whose rows carry a description where
			// a prospect carries a rationale
			const findings = {
				competitors: [
					{ name: 'Gremio de Instaladores de Madrid', description: 'Sector.' },
					{
						name: 'AEMIAT',
						description: 'Regional association of installation firms.',
					},
					{ name: 'Elecnor', description: 'Contractor.' },
				],
			}

			// WHEN checked against that list's own key
			// THEN both bodies go — the one that says what it is in its name and the one
			// that says it in its description — so neither scan goes unchecked for the
			// want of a field name
			const result = dropNonCompanies(findings, 'competitors')
			expect(
				(
					result.findings as { competitors: Array<{ name: string }> }
				).competitors.map(row => row.name),
			).toEqual(['Elecnor'])
		})

		it('should leave a list entry that is not an object alone', () => {
			// GIVEN a list holding something that is not a row
			const findings = scan([])
			const withJunk = { prospects: [null, 'Asociación', { name: 'Elecnor' }] }

			// WHEN checked — THEN only real rows are judged
			expect(dropNonCompanies(findings, 'prospects').dropped).toEqual([])
			const result = dropNonCompanies(withJunk, 'prospects')
			expect(
				(result.findings as { prospects: Array<unknown> }).prospects,
			).toEqual([null, 'Asociación', { name: 'Elecnor' }])
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN checked — THEN they pass straight through
			expect(dropNonCompanies(null, 'prospects').findings).toBeNull()
			expect(dropNonCompanies('text', 'prospects').findings).toBe('text')
		})
	})
})
