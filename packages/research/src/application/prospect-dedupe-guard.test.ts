import { describe, expect, it } from 'vitest'

import { dedupeDiscoveryRows } from './prospect-dedupe-guard'

const scan = (
	prospects: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> => ({ prospects })

const rowsOf = (findings: unknown): Array<Record<string, unknown>> =>
	(findings as { prospects: Array<Record<string, unknown>> }).prospects

// The pages the surviving row ends up citing, in order.
const citedPagesOf = (findings: unknown): Array<unknown> => {
	const citations = rowsOf(findings)[0]?.['citations']
	return Array.isArray(citations)
		? citations.map(citation => (citation as { source_id: string }).source_id)
		: []
}

describe('dedupeDiscoveryRows', () => {
	describe('when two rows are the same company under different spellings', () => {
		it('should fold a row that only differs by its legal form', () => {
			// GIVEN one company met twice, once with the form on the end
			const findings = scan([
				{
					name: 'Cobra Instalaciones y Servicios',
					why_relevant: 'Contractor.',
				},
				{ name: 'COBRA INSTALACIONES Y SERVICIOS SA', why_relevant: 'Ranked.' },
			])

			// WHEN the list is de-duplicated
			// THEN one row survives — the form comes off the end of the name key, so
			// the two spellings meet
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['name']).toBe(
				'Cobra Instalaciones y Servicios',
			)
			expect(result.merged).toBe(1)
		})

		it('should fold a row that only differs by its accents', () => {
			// GIVEN the same company written with and without accents
			const findings = scan([
				{ name: 'Eléctricas Muñoz SL', why_relevant: 'Installer.' },
				{ name: 'Electricas Munoz SL', why_relevant: 'Directory entry.' },
			])

			// WHEN de-duplicated — THEN accents fold before the names are compared
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should fold a row whose legal form is written with dots', () => {
			// GIVEN the two ways a Spanish company writes the same form
			const findings = scan([
				{ name: 'Eléctricas Muñoz SL', why_relevant: 'Installer.' },
				{ name: 'Electricas Munoz, S.L.', why_relevant: 'Register extract.' },
			])

			// WHEN de-duplicated
			// THEN the dots come out before the form is read off the end, so it is one
			// company rather than one whose form reads as two more words of its name
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should fold two rows sharing a site even when the names do not meet', () => {
			// GIVEN a company met once under its trade name and once under its legal one
			const findings = scan([
				{ name: 'SICE', website: 'https://www.sice.com', why_relevant: 'A.' },
				{
					name: 'Sociedad Ibérica de Construcciones Eléctricas',
					website: 'https://sice.com/es',
					why_relevant: 'B.',
				},
			])

			// WHEN de-duplicated — THEN the site settles it: the host is the same one
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should carry sameness across rows that meet by different keys', () => {
			// GIVEN A and B meeting by name, and B and C meeting by site
			const findings = scan([
				{ name: 'Elecnor SA', why_relevant: 'A.' },
				{ name: 'Elecnor', website: 'https://elecnor.com', why_relevant: 'B.' },
				{ name: 'Grupo Elecnor Servicios', website: 'https://elecnor.com/es' },
			])

			// WHEN de-duplicated
			// THEN all three become one company, which is what they are
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(result.merged).toBe(2)
		})

		it('should reach the same answer whatever order the rows arrive in', () => {
			// GIVEN the same three rows with the one that bridges them — matching the
			// first by name and the second by site — arriving last instead of between
			const findings = scan([
				{ name: 'Elecnor SA', why_relevant: 'A.' },
				{ name: 'Grupo Elecnor Servicios', website: 'https://elecnor.com/es' },
				{ name: 'Elecnor', website: 'https://elecnor.com', why_relevant: 'B.' },
			])

			// WHEN de-duplicated
			// THEN still one company. The bridge row joins two rows that were until
			// then separate, and a list arrives in whatever order the model wrote it —
			// so an answer that changed with the order would be no answer at all
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(result.merged).toBe(2)
		})
	})

	describe('when the rows being folded hold different facts', () => {
		it('should fill the gaps in the row that stays from the later one', () => {
			// GIVEN a first meeting with no tax id and a second that found one
			const findings = scan([
				{ name: 'Instalaciones Rubio SL', why_relevant: 'Installer in Vigo.' },
				{
					name: 'Instalaciones Rubio',
					tax_id: 'B36123456',
					location: 'Vigo, Pontevedra',
					why_relevant: 'Register extract.',
				},
			])

			// WHEN de-duplicated
			// THEN the later row's findings survive on the row that stays — dropping it
			// outright would throw away what the run paid to find
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]).toMatchObject({
				name: 'Instalaciones Rubio SL',
				tax_id: 'B36123456',
				location: 'Vigo, Pontevedra',
				why_relevant: 'Installer in Vigo.',
			})
		})

		it('should never overwrite a field the surviving row already states', () => {
			// GIVEN both rows stating a different industry
			const findings = scan([
				{ name: 'Acme SL', industry: 'electrical', why_relevant: 'First.' },
				{ name: 'ACME S.L.', industry: 'construction', why_relevant: 'Later.' },
			])

			// WHEN de-duplicated
			// THEN the first reading stays: it is the one the checks upstream weighed
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['industry']).toBe('electrical')
		})

		it('should treat a null or absent field as a gap to fill', () => {
			// GIVEN a first row whose website came back blanked by an earlier check
			const findings = scan([
				{ name: 'Acme SL', website: null, why_relevant: 'First.' },
				{ name: 'ACME SA', website: 'https://acme.es', why_relevant: 'Later.' },
			])

			// WHEN de-duplicated — THEN the blank is a gap, so the later value lands
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['website']).toBe('https://acme.es')
		})

		it('should add the pages of the later row without repeating one already cited', () => {
			// GIVEN two rows citing one page in common and one page each
			const findings = scan([
				{
					name: 'Acme SL',
					why_relevant: 'First.',
					citations: [
						{ source_id: 'https://acme.es', confidence: 0.9 },
						{ source_id: 'https://ranking.es', confidence: 0.6 },
					],
				},
				{
					name: 'ACME SA',
					why_relevant: 'Later.',
					citations: [
						{ source_id: 'https://acme.es', confidence: 0.5 },
						{ source_id: 'https://registro.es', confidence: 0.8 },
					],
				},
			])

			// WHEN de-duplicated
			// THEN the surviving row keeps everything the run read, each page once
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(citedPagesOf(result.findings)).toEqual([
				'https://acme.es',
				'https://ranking.es',
				'https://registro.es',
			])
		})

		it('should take the pages of the later row when the row that stays cited none', () => {
			// GIVEN a first row with no citations at all
			const findings = scan([
				{ name: 'Acme SL', why_relevant: 'First.' },
				{
					name: 'ACME SA',
					why_relevant: 'Later.',
					citations: [{ source_id: 'https://acme.es', confidence: 0.9 }],
				},
			])

			// WHEN de-duplicated — THEN the evidence still reaches the row that stays
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(citedPagesOf(result.findings)).toEqual(['https://acme.es'])
		})
	})

	describe('when the rows are different companies', () => {
		it('should keep two companies that share neither a name nor a site', () => {
			// GIVEN two genuinely different installers
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://mora.es' },
				{ name: 'Montajes Tejero', website: 'https://tejero.es' },
			])

			// WHEN de-duplicated — THEN both stay and nothing is counted as merged
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})

		it('should still fold two rows whose names are only a legal form', () => {
			// GIVEN two rows named nothing but a legal form, which leaves no core
			const findings = scan([
				{ name: 'SL', why_relevant: 'One.' },
				{ name: 'S.L.', why_relevant: 'Another.' },
			])

			// WHEN de-duplicated
			// THEN they still meet, on the name as written. Neither is a company anyone
			// can work with, but leaving them with no key at all would let the list
			// keep every copy of the same useless row
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should not group two rows on a website that is not an address', () => {
			// GIVEN two rows carrying prose where a site belongs
			const findings = scan([
				{ name: 'Alpha Instal', website: 'not provided', why_relevant: 'One.' },
				{ name: 'Beta Instal', website: 'not provided', why_relevant: 'Two.' },
			])

			// WHEN de-duplicated — THEN no host can be read, so neither row lends one
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(2)
		})
	})

	describe('when the answer is not a list of companies', () => {
		it('should pass a run through untouched when it has no list', () => {
			// GIVEN a run about one named company
			const findings = { enrichment: { industry: 'electrical' } }

			// WHEN de-duplicated with no list field — THEN nothing is compared
			const result = dedupeDiscoveryRows(findings, undefined)
			expect(result.findings).toBe(findings)
			expect(result.merged).toBe(0)
		})

		it('should leave a list entry that is not a row alone', () => {
			// GIVEN a list holding something that is not an object
			const findings = { prospects: [null, { name: 'Elecnor' }] }

			// WHEN de-duplicated — THEN only real rows are compared
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toEqual([null, { name: 'Elecnor' }])
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN de-duplicated — THEN they pass straight through
			expect(dedupeDiscoveryRows(null, 'prospects').findings).toBeNull()
			expect(dedupeDiscoveryRows('text', 'prospects').findings).toBe('text')
		})
	})
})
