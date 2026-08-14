import { describe, expect, it } from 'vitest'

import {
	branchOfficeParents,
	dedupeDiscoveryRows,
} from './prospect-dedupe-guard'

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

	describe('when a company arrives again for each of its branch offices', () => {
		it('should fold a market list down to the company the branches belong to', () => {
			// GIVEN the rows a French market search came back with: the company once
			// with its site, and four branch offices carrying only their town
			const findings = scan([
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com/',
					why_relevant: 'Solar installer.',
				},
				{ name: 'Terre Solaire – agence Douains', location: 'Douains' },
				{ name: 'Terre Solaire – agence Longueau', location: 'Longueau' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{ name: 'Terre Solaire – agence Montpellier', location: 'Montpellier' },
			])

			// WHEN de-duplicated
			// THEN one company comes back, under its own name
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['name']).toBe('Terre Solaire')
			expect(result.merged).toBe(4)
		})

		it('should keep every town the branches work from', () => {
			// GIVEN a company stating no place of its own and three branches that each
			// state the only one they have
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire – agence Douains', location: 'Douains' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{ name: 'Terre Solaire – agence Montpellier', location: 'Montpellier' },
			])

			// WHEN de-duplicated
			// THEN all three towns survive on the row that stays — taking whichever
			// arrived first would drop the other two with nothing said
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe(
				'Douains; Lyon; Montpellier',
			)
		})

		it('should name a town once when two branches share it', () => {
			// GIVEN two branches of one company sitting in the same town
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{ name: 'Terre Solaire – bureau Lyon', location: 'Lyon' },
			])

			// WHEN de-duplicated — THEN the town is stated once, not twice
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Lyon')
		})

		it('should report the company under its own name when a branch arrived first', () => {
			// GIVEN a list that ranked a branch page above the company's own
			const findings = scan([
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com/',
					why_relevant: 'Solar installer.',
				},
			])

			// WHEN de-duplicated
			// THEN the reader is told the company's name, not one branch's. Which row a
			// search happened to rank first is no reason to call it something else
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]).toMatchObject({
				name: 'Terre Solaire',
				website: 'https://terresolaire.com/',
				location: 'Lyon',
			})
		})

		it('should reach the same answer whatever order the branches arrive in', () => {
			// GIVEN the same five rows with the company's own row buried in the middle
			const findings = scan([
				{ name: 'Terre Solaire – agence Montpellier', location: 'Montpellier' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire – agence Douains', location: 'Douains' },
				{ name: 'Terre Solaire – agence Longueau', location: 'Longueau' },
			])

			// WHEN de-duplicated
			// THEN one company under its own name, with every town still on it
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]).toMatchObject({
				name: 'Terre Solaire',
				website: 'https://terresolaire.com/',
				location: 'Montpellier; Lyon; Douains; Longueau',
			})
		})

		it('should still fold a branch whose website field holds prose', () => {
			// GIVEN a branch row that answered the website question in words
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{
					name: 'Terre Solaire – agence Lyon',
					website: 'not provided',
					location: 'Lyon',
				},
			])

			// WHEN de-duplicated — THEN no address can be read from it, so it is still a
			// row with no site of its own
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should keep a branch that claims a site of its own', () => {
			// GIVEN a row that names a second host
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{
					name: 'Terre Solaire – agence Lyon',
					website: 'https://terresolaire-lyon.fr',
					location: 'Lyon',
				},
			])

			// WHEN de-duplicated
			// THEN both stay: a row claiming its own web presence is claiming to be
			// somebody, and two hosts are the strongest evidence of two of them
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(2)
		})

		it("should keep the head office's own town beside its branches", () => {
			// GIVEN a branch met first and the company itself, each stating its own town
			const findings = scan([
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com/',
					location: 'Paris',
				},
			])

			// WHEN de-duplicated — THEN both towns are named, whichever arrived first
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Lyon; Paris')
		})

		it("should not add a second reading of the same branch's town", () => {
			// GIVEN a branch, its company, and the branch met again on the company's own
			// site — which joins on the host rather than as a branch of its own
			const findings = scan([
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{
					name: 'Agence Terre Solaire Lyon',
					website: 'https://terresolaire.com/agences/lyon',
					location: 'Lyon, Rhône',
				},
			])

			// WHEN de-duplicated
			// THEN the first reading of that town stands. Only a row speaking about
			// somewhere else adds a place; another reading of one branch is not that
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Lyon')
		})

		it('should name one town once when two branches write it at different detail', () => {
			// GIVEN two branch rows in the same town, one naming the province too
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{ name: 'Terre Solaire – bureau Lyon', location: 'Lyon, Rhône' },
			])

			// WHEN de-duplicated
			// THEN one town, not two. A place that holds one already named is the same
			// place written at more detail, and listing both would invent a branch
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Lyon')
		})

		it('should keep two towns whose names merely read inside one another', () => {
			// GIVEN branches in Roa and in Roanne — two real towns, one spelled inside
			// the other letter for letter
			const findings = scan([
				{ name: 'Acme Solar', website: 'https://acmesolar.fr' },
				{ name: 'Acme Solar Roa', location: 'Roa' },
				{ name: 'Acme Solar Roanne', location: 'Roanne' },
			])

			// WHEN de-duplicated
			// THEN both towns are named. Places are compared word by word, so one town
			// reading inside another is not the same town written at more detail
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Roa; Roanne')
		})

		it('should keep a town written in a script the folding cannot read', () => {
			// GIVEN a branch in a town spelled in Latin letters, and the company itself
			// stating a town this code's folding comes apart into no words at all
			const findings = scan([
				{ name: 'Acme Solar Osaka', location: 'Osaka' },
				{
					name: 'Acme Solar',
					website: 'https://acmesolar.example',
					location: '東京',
				},
			])

			// WHEN de-duplicated
			// THEN the unreadable town is kept beside the readable one. A place the
			// code cannot read is a place it must not throw away for that reason
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Osaka; 東京')
		})

		it('should ignore a company that names nowhere when it joins its branch', () => {
			// GIVEN a branch met first, and the company itself whose place is only spaces
			const findings = scan([
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com/',
					location: '   ',
				},
			])

			// WHEN de-duplicated
			// THEN the branch's town stands alone. A row naming nowhere adds nowhere,
			// rather than a blank reading trailing the one place the run did find
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Lyon')
		})

		it('should not join the places of two rows that are one company met twice', () => {
			// GIVEN one company met twice, each meeting reading its place differently
			const findings = scan([
				{ name: 'Instalaciones Rubio SL', location: 'Vigo' },
				{ name: 'Instalaciones Rubio', location: 'Vigo, Pontevedra' },
			])

			// WHEN de-duplicated
			// THEN the first reading stands. Two readings of one place are not two
			// places, and only a branch speaks about somewhere else
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Vigo')
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

describe('branchOfficeParents', () => {
	describe("when a row reads as another row's branch office", () => {
		it("should read a row ending on the town it gives as that company's branch", () => {
			// GIVEN a company and a row named after it plus the town that row sits in
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN the second belongs to the first — read off the shape alone, with no
			// need to know that "agence" is French for a branch office
			expect(branchOfficeParents(rows)).toEqual(new Map([[1, 0]]))
		})

		it('should read the legal form off both names before comparing them', () => {
			// GIVEN a company carrying its legal form and a branch that does not
			const rows = [
				{ name: 'Terre Solaire SARL', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire – agence Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out — THEN the form is no obstacle
			expect(branchOfficeParents(rows)).toEqual(new Map([[1, 0]]))
		})

		it('should follow a branch that hangs off another branch', () => {
			// GIVEN a company, a branch of it, and a sub-office of that branch
			const rows = [
				{ name: 'Acme Solar', website: 'https://acmesolar.fr' },
				{ name: 'Acme Solar Lyon', location: 'Lyon' },
				{ name: 'Acme Solar Lyon Sud', location: 'Lyon Sud' },
			]

			// WHEN the branches are worked out — THEN each hangs off the one above it
			expect(branchOfficeParents(rows)).toEqual(
				new Map([
					[1, 0],
					[2, 1],
				]),
			)
		})

		it('should hang a branch off the longest name it could hang off', () => {
			// GIVEN two companies whose names open the same way, and a branch of the
			// longer one
			const rows = [
				{ name: 'Acme', website: 'https://acme.fr' },
				{ name: 'Acme Solar', website: 'https://acmesolar.fr' },
				{ name: 'Acme Solar Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN the branch belongs to "Acme Solar" alone. Letting it belong to both
			// would drag those two companies into one through it
			expect(branchOfficeParents(rows)).toEqual(new Map([[2, 1]]))
		})
	})

	describe('when two rows merely open with the same word', () => {
		it('should keep two different companies whose names share an opening word', () => {
			// GIVEN one company and a genuinely different one whose name starts with it
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire Energie', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN neither belongs to the other. "One name starts the other" is not
			// enough on its own — "Energie" is not where anybody is
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should keep them separate through the fold as well', () => {
			// GIVEN those same two companies going through the whole de-duplication
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire Energie', location: 'Lyon' },
			])

			// WHEN de-duplicated — THEN two companies come back, as they should
			const result = dedupeDiscoveryRows(findings, 'prospects')
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})

		it('should compare whole words rather than letters', () => {
			// GIVEN a name that starts with the other's letters but not its words
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terres Solaires Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN no branch: "terresolaire" opening "terressolaireslyon" is a trick of
			// the spelling, and these are two companies
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should not take a joiner the place happens to share for the town', () => {
			// GIVEN a row whose trailing words hold "del", which its place holds too
			const rows = [
				{ name: 'Acme Servicios', website: 'https://acme.es' },
				{ name: 'Acme Servicios del Norte', location: 'Puerto del Rosario' },
			]

			// WHEN the branches are worked out
			// THEN no branch. The name has to END on the town, so a joiner sitting in
			// the middle of both cannot pass for one
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should pass over an anchor too short to stand for a company', () => {
			// GIVEN a two-letter name that every longer name would open with
			const rows = [
				{ name: 'AB', website: 'https://ab.fr' },
				{ name: 'AB Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN nothing hangs off it: a name that short turns up inside unrelated
			// ones by coincidence, so it anchors nobody
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})
	})

	describe('when a row cannot be read as a branch at all', () => {
		it('should leave a row that states no place', () => {
			// GIVEN a longer name with nothing saying where it is
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire agence Lyon' },
			]

			// WHEN the branches are worked out
			// THEN no branch: the town is what the row has to tell us before its own
			// name can be checked against it
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should leave a row whose place is not written as text', () => {
			// GIVEN a place that arrived as something other than a string
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire agence Lyon', location: { city: 'Lyon' } },
			]

			// WHEN the branches are worked out — THEN there is no town to read
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should leave a row whose name is nothing a word can be read from', () => {
			// GIVEN a name of pure punctuation
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: '– —', location: 'Lyon' },
			]

			// WHEN the branches are worked out — THEN it hangs off nobody
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it("should leave a row that is no company's name and then some", () => {
			// GIVEN a row named after its town alone, with no company above it
			const rows = [
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Solaire Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out — THEN there is nothing to hang it off
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should leave two rows carrying exactly the same name', () => {
			// GIVEN one name twice, the second stating the town it ends on
			const rows = [
				{ name: 'Acme Lyon', website: 'https://acme.fr' },
				{ name: 'Acme Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN neither is the other's branch — they are the same name, which the
			// name key already folds
			expect(branchOfficeParents(rows)).toEqual(new Map())
		})

		it('should leave list entries that are not rows alone', () => {
			// GIVEN a list holding a null and a row with no name
			const rows = [
				null,
				{ website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{ name: 'Terre Solaire agence Lyon', location: 'Lyon' },
			]

			// WHEN the branches are worked out
			// THEN only the real rows are read, and the branch still finds its company
			expect(branchOfficeParents(rows)).toEqual(new Map([[3, 2]]))
		})

		it('should find no branches in an empty list', () => {
			// GIVEN nothing to read
			// WHEN the branches are worked out — THEN there are none
			expect(branchOfficeParents([])).toEqual(new Map())
		})
	})
})
