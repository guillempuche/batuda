import { describe, expect, it } from 'vitest'

import {
	bracketedNoteParents,
	branchOfficeParents,
	dedupeDiscoveryRows,
	discoveryRowIdentityKeys,
	hostsEstablishedAsOwn,
	isSiteKey,
} from './prospect-dedupe-guard'
import { runWordsOf } from './run-words'

// A run that named no trades, which is a request about one company on file.
const noRunWords = runWordsOf([])

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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should fold two rows sharing a site given with the page it was read on', () => {
			// GIVEN the same pair as above, but with each website written the way the
			// scan schema actually asks for it — the address paired with the page it
			// came from. Every fixture here had held a bare string, a shape the
			// pipeline stopped producing when the field gained its source, so the
			// whole site-based fold had been quietly doing nothing and no test said so
			const findings = scan([
				{
					name: 'SICE',
					website: {
						value: 'https://www.sice.com',
						source_id: 'https://www.sice.com',
						confidence: null,
					},
					why_relevant: 'A.',
				},
				{
					name: 'Sociedad Ibérica de Construcciones Eléctricas',
					website: {
						value: 'https://sice.com/es',
						source_id: 'https://sice.com/es',
						confidence: null,
					},
					why_relevant: 'B.',
				},
			])

			// WHEN de-duplicated — THEN the host still settles it
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)[0]?.['industry']).toBe('electrical')
		})

		it('should treat a null or absent field as a gap to fill', () => {
			// GIVEN a first row whose website came back blanked by an earlier check
			const findings = scan([
				{ name: 'Acme SL', website: null, why_relevant: 'First.' },
				{ name: 'ACME SA', website: 'https://acme.es', why_relevant: 'Later.' },
			])

			// WHEN de-duplicated — THEN the blank is a gap, so the later value lands
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})

		it('should leave two companies whose only shared words are their form', () => {
			// GIVEN two unrelated Chinese companies, each written with an English legal
			// form after it — the ordinary shape of a name a scan brings back from an
			// English-language page about a Chinese market
			const findings = scan([
				{ name: '上海高博 Co., Ltd', why_relevant: 'One.' },
				{ name: '北京华信 Co., Ltd', why_relevant: 'Another.' },
			])

			// WHEN de-duplicated
			// THEN both stay. The fold has no letters for the names themselves, so what
			// it hands back is the English written beside them — and filing on that made
			// every company ending "Co., Ltd" the same company
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
		})

		it('should not group two rows on a website that is not an address', () => {
			// GIVEN two rows carrying prose where a site belongs
			const findings = scan([
				{ name: 'Alpha Instal', website: 'not provided', why_relevant: 'One.' },
				{ name: 'Beta Instal', website: 'not provided', why_relevant: 'Two.' },
			])

			// WHEN de-duplicated — THEN no host can be read, so neither row lends one
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
		})

		it('should keep two companies handed a page each on a host neither is named by', () => {
			// GIVEN two installers each given their page in a trade body's member list
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
			])

			// WHEN de-duplicated
			// THEN both stay. The domain spells neither of them, so it is nobody's own
			// site and says nothing about whether these are one company
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings).map(row => row['name'])).toEqual([
				'Electricidad Mora',
				'Instalaciones Rubio',
			])
			expect(result.merged).toBe(0)
		})

		it("should not carry sameness through a host that is nobody's own", () => {
			// GIVEN A and B meeting by name, and C sharing only the trade body's host
			const findings = scan([
				{ name: 'Electricidad Mora SL', why_relevant: 'A.' },
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
			])

			// WHEN de-duplicated
			// THEN the two spellings of one name still meet, and the third company is
			// not dragged in behind them by an address none of the three owns
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings).map(row => row['name'])).toEqual([
				'Electricidad Mora SL',
				'Instalaciones Rubio',
			])
			expect(result.merged).toBe(1)
		})
	})

	describe('when a host belongs to one of the rows standing on it', () => {
		it('should fold a row given a page on a company site that spells that company', () => {
			// GIVEN a company at the domain that spells its name, and a second row the
			// run put on a page of that same site under a name of its own
			const findings = scan([
				{ name: 'Terre Solaire', website: 'https://terresolaire.com/' },
				{
					name: 'SAS Soleil du Sud',
					website: 'https://terresolaire.com/qui-sommes-nous',
				},
			])

			// WHEN de-duplicated
			// THEN one company. The domain says whose site it is, so the row beside it
			// is that company again under another name — the trade name beside the
			// legal one, which is the pair this fold exists for
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['name']).toBe('Terre Solaire')
		})

		it('should let a third row establish the host the other two stand on', () => {
			// GIVEN two rows on a host neither of their names spells, and a third row
			// whose name does
			const findings = scan([
				{
					name: 'Sociedad Ibérica de Construcciones Eléctricas',
					website: 'https://sice.com/es',
				},
				{
					name: 'Ibérica de Señalización Vial',
					website: 'https://sice.com/senalizacion',
				},
				{ name: 'SICE', website: 'https://www.sice.com' },
			])

			// WHEN de-duplicated
			// THEN all three are one company. Who owns a domain is read across the whole
			// list, so the row that spells it settles the host for every row on it
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(result.merged).toBe(2)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['name']).toBe('Terre Solaire')
			expect(result.merged).toBe(4)
		})

		it("should leave a branch office's mark behind when it folds", () => {
			// GIVEN a company in the area a scan asked about, met a second time as
			// its own branch somewhere else — and that branch marked as outside the
			// area. The fold fills any field the surviving row is missing, so without
			// a rule the mark would cross over and the company itself would come back
			// badged as being somewhere it is not
			const findings = scan([
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com/',
					location: 'Montpellier',
					why_relevant: 'Solar installer.',
				},
				{
					name: 'Terre Solaire – agence Douains',
					location: 'Douains',
					marks: ['outside_requested_place'],
				},
			])

			// WHEN de-duplicated
			// THEN one company comes back, wearing no mark: a fold can take a mark
			// away, never hand one out
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['marks']).toBeUndefined()
		})

		it('should leave behind everything a guard concluded about the branch', () => {
			// GIVEN a branch carrying not just the mark but the reason behind it and
			// the older single-value mark beside it. Withholding the mark alone
			// leaves its reason attached to a company nobody judged, and the tool
			// description tells an assistant that reason IS the mark's
			const findings = scan([
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com/',
					location: 'Montpellier',
					why_relevant: 'Solar installer.',
				},
				{
					name: 'Terre Solaire – agence Douains',
					location: 'Douains',
					marks: ['outside_requested_place'],
					outside_place_reason: 'Douains is in Normandy',
					unconfirmed_evidence: 'name_only_listing',
				},
			])

			// WHEN de-duplicated
			// THEN none of the three crosses over. The surviving company has a site
			// and a place, so "found only as a name on a list" would be plainly
			// untrue of it, and it was never judged to be anywhere but Montpellier
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			const kept = rowsOf(result.findings)[0]
			expect(kept?.['marks']).toBeUndefined()
			expect(kept?.['outside_place_reason']).toBeUndefined()
			expect(kept?.['unconfirmed_evidence']).toBeUndefined()
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Vigo')
		})
	})

	describe("when the brackets hold the company's other name", () => {
		it('should meet the row written under that other name', () => {
			// GIVEN the three spellings a Castellbisbal scan actually returned. The
			// middle row is the only thing tying the other two together, because it
			// is the only one that says both names.
			const findings = scan([
				{ name: 'SOPREMA (Castellbisbal)', location: 'Castellbisbal' },
				{ name: 'SOPREMA (SOPREMA IBERIA, S.L.)', location: 'Castellbisbal' },
				{ name: 'SOPREMA IBERIA S.L.U.', location: 'Castellbisbal' },
			])

			// WHEN the list is de-duplicated
			// THEN the two rows that name SOPREMA IBERIA become one. The row naming
			// only the town stays out: with no plain "SOPREMA" on the list, there is
			// nothing saying it is the same company rather than another arm.
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(1)
		})

		it('should not join on a name the brackets only happen to contain', () => {
			// GIVEN a short company name that turns up inside its own town by
			// chance — "ara" sits inside "zaragoza" — beside a company actually
			// called that town
			const findings = scan([
				{ name: 'Ara (Zaragoza)', location: 'Zaragoza' },
				{ name: 'Zaragoza SL', location: 'Zaragoza' },
			])

			// WHEN the list is de-duplicated
			// THEN both survive: the brackets have to start on the name outside
			// them to be read as that company's other name, so a chance substring
			// cannot make two companies one
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})

		it('should not let a town in brackets join two unrelated companies', () => {
			// GIVEN two different companies each written with the same town after it
			const findings = scan([
				{ name: 'SOPREMA (Castellbisbal)', location: 'Castellbisbal' },
				{ name: 'Fusteria Roca (Castellbisbal)', location: 'Castellbisbal' },
			])

			// WHEN the list is de-duplicated
			// THEN both survive: the brackets have to repeat the name outside them to
			// count as a second name, and a town never does
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})
	})

	describe('when a scan wrote a note after a name it had already written down', () => {
		it('should fold a row whose name carries the directory it was met on', () => {
			// GIVEN the pair a French market run actually returned, the second row's
			// own words calling itself a duplicate
			const findings = scan([
				{ name: 'KBE Energy', why_relevant: 'Solar installer.' },
				{
					name: 'KBE Energy (Annuaire Tecsol entry)',
					why_relevant: 'Duplicate entry of KBE Energy in the Tecsol list.',
				},
			])

			// WHEN the list is de-duplicated
			// THEN one row survives, under the name without the note
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['name']).toBe('KBE Energy')
			expect(result.merged).toBe(1)
		})

		it('should fold a row whose name carries the trade it was found under', () => {
			// GIVEN the other pair the same market returned
			const findings = scan([
				{ name: '2C ENERGIES', location: "Val-d'Oise (95)" },
				{
					name: '2C ENERGIES (CHAUFFAGE CLIMATISATION ENERGIES)',
					location: 'Presles',
				},
			])

			// WHEN de-duplicated — THEN one row, and the note row's town fills nothing
			// it already answered: this is one company written twice, not a second
			// place the company works from
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['location']).toBe("Val-d'Oise (95)")
		})

		it('should keep the plain name when the noted row came back first', () => {
			// GIVEN the noted row ranked ahead of the plain one
			const findings = scan([
				{ name: 'KBE Energy (Annuaire Tecsol entry)', location: 'Paris' },
				{ name: 'KBE Energy' },
			])

			// WHEN de-duplicated — THEN the company keeps its own name, and what the
			// noted row knew is not thrown away with the brackets
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(1)
			expect(rowsOf(result.findings)[0]?.['name']).toBe('KBE Energy')
			expect(rowsOf(result.findings)[0]?.['location']).toBe('Paris')
		})

		it('should keep two rows whose brackets are what tells them apart', () => {
			// GIVEN a company's two arms, each named by where it trades
			const findings = scan([{ name: 'Acme (UK)' }, { name: 'Acme (US)' }])

			// WHEN de-duplicated — THEN both survive. Taking brackets off every name
			// before filing it would have folded these two, which is why the plain
			// name has to be on the list for a note to read as a note
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})

		it('should keep all three when the plain name is on the list beside them', () => {
			// GIVEN the bare name as well
			const findings = scan([
				{ name: 'Acme' },
				{ name: 'Acme (UK)' },
				{ name: 'Acme (US)' },
			])

			// WHEN de-duplicated — THEN three rows: folding either arm onto the bare
			// row would drag the other in through it
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(3)
		})

		it("should add the noted row's pages to the row that stays", () => {
			// GIVEN each row citing a page the other did not
			const findings = scan([
				{ name: 'KBE Energy', citations: [{ source_id: 'src_own' }] },
				{
					name: 'KBE Energy (Annuaire Tecsol entry)',
					citations: [{ source_id: 'src_tecsol' }],
				},
			])

			// WHEN de-duplicated — THEN the surviving row is backed by both
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(citedPagesOf(result.findings)).toEqual(['src_own', 'src_tecsol'])
		})
	})

	describe('when one name is another name and then more words', () => {
		it('should keep a name beside the same name with a word in front of it', () => {
			// GIVEN the pair a French market run returned, which is one company
			const findings = scan([
				{ name: 'SNEF' },
				{
					name: 'Groupe SNEF',
					website: 'https://snef.fr',
					location: 'Marseille',
				},
			])

			// WHEN de-duplicated — THEN both survive, and that is not an oversight.
			// Joining them needs to know that "Groupe" adds nothing to a name, which
			// is a list of words per language
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
		})

		it('should keep a name beside the same name with words after it', () => {
			// GIVEN the other pair from that run, also one company
			const findings = scan([
				{ name: 'VOLTEC' },
				{ name: 'Voltec Power Technology Solutions' },
			])

			// WHEN de-duplicated — THEN both survive
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
		})

		it('should keep a pair that is that same shape once a plural is folded', () => {
			// GIVEN a pair a French run returned, one company, differing by a plural
			// and by one trailing word
			const findings = scan([
				{ name: 'PPVS – Facility Management France' },
				{
					name: 'PPVS – Facilities Management',
					website: 'https://ppvs-fm.com',
					location: 'Paris',
				},
			])

			// WHEN de-duplicated — THEN both survive. Folding the plural away is the
			// smaller half: grant it and what is left is one name being the other plus
			// a trailing word, with no town stated to check that word against, which is
			// the case above and closed for the same reason
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
		})

		it('should keep two real companies whose names sit in the same shape', () => {
			// GIVEN a name and a genuinely different company whose name is that name
			// and then a word — row for row the same shape as the pair above, with the
			// same fields to read, which is why neither can be folded
			const findings = scan([
				{ name: 'Terre Solaire' },
				{ name: 'Terre Solaire Energie' },
			])

			// WHEN de-duplicated — THEN both survive, which is the right answer here
			// and the wrong one above, and nothing on the rows says which is which
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})
	})

	describe('when the answer is not a list of companies', () => {
		it('should pass a run through untouched when it has no list', () => {
			// GIVEN a run about one named company
			const findings = { enrichment: { industry: 'electrical' } }

			// WHEN de-duplicated with no list field — THEN nothing is compared
			const result = dedupeDiscoveryRows(findings, undefined, noRunWords)
			expect(result.findings).toBe(findings)
			expect(result.merged).toBe(0)
		})

		it('should leave a list entry that is not a row alone', () => {
			// GIVEN a list holding something that is not an object
			const findings = { prospects: [null, { name: 'Elecnor' }] }

			// WHEN de-duplicated — THEN only real rows are compared
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toEqual([null, { name: 'Elecnor' }])
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN de-duplicated — THEN they pass straight through
			expect(
				dedupeDiscoveryRows(null, 'prospects', noRunWords).findings,
			).toBeNull()
			expect(
				dedupeDiscoveryRows('text', 'prospects', noRunWords).findings,
			).toBe('text')
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
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
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

describe('bracketedNoteParents', () => {
	describe('when a name carries a note somebody wrote after it', () => {
		it('should read it as the same company as the plain name beside it', () => {
			// GIVEN a scan that wrote down where it met a company, after the name
			const rows = [
				{ name: 'KBE Energy' },
				{ name: 'KBE Energy (Annuaire Tecsol entry)' },
			]

			// WHEN the notes are read
			// THEN the noted row belongs to the plain one
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[1, 0]])
		})

		it('should read the note whichever way round the two rows arrived', () => {
			// GIVEN the noted row first and the plain one after it
			const rows = [
				{ name: 'KBE Energy (Annuaire Tecsol entry)' },
				{ name: 'KBE Energy' },
			]

			// WHEN the notes are read — THEN the plain row is still the one it belongs
			// to, because which row a search ranked first says nothing about the name
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[0, 1]])
		})

		it('should read the legal form off both names before comparing them', () => {
			// GIVEN the plain row carrying a legal form the noted one does not
			const rows = [
				{ name: 'Acme Energie SARL' },
				{ name: 'Acme Energie (Annuaire entry)' },
			]

			// WHEN the notes are read — THEN the form comes off before the names meet
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[1, 0]])
		})

		it('should read a note written after space at the end of the name', () => {
			// GIVEN a name whose brackets are padded and trailed with spaces
			const rows = [
				{ name: 'Acme Energie' },
				{ name: 'Acme Energie  (note)  ' },
			]

			// WHEN the notes are read — THEN the padding is not what tells them apart
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[1, 0]])
		})

		it('should treat one note written two ways as one note', () => {
			// GIVEN the same note after the same name twice, spelled differently
			const rows = [
				{ name: 'Acme Energie' },
				{ name: 'Acme Energie (Annuaire)' },
				{ name: 'Acme Energie (annuaire)' },
			]

			// WHEN the notes are read — THEN both belong to the plain row: the
			// brackets are not telling the two rows apart, they say the same thing
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([
				[1, 0],
				[2, 0],
			])
		})
	})

	describe('when the brackets are telling two rows apart', () => {
		it('should leave two rows whose notes differ and no plain name beside them', () => {
			// GIVEN a company's two arms, each named by where it trades
			const rows = [{ name: 'Acme (UK)' }, { name: 'Acme (US)' }]

			// WHEN the notes are read — THEN nothing folds: neither row is the plain
			// name the other is a second reading of
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should leave them even when the plain name is on the list as well', () => {
			// GIVEN the bare name beside both of them
			const rows = [
				{ name: 'Acme' },
				{ name: 'Acme (UK)' },
				{ name: 'Acme (US)' },
			]

			// WHEN the notes are read — THEN still nothing: two different notes on one
			// name are distinguishing the rows, and folding either onto the bare row
			// would drag all three together through it
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should read a noted row past two hosts neither company is named by', () => {
			// GIVEN the pair a live French search returned: one row citing another
			// company's site altogether, the other a social page
			const rows = [
				{
					name: 'Société Nouvelle Garraud',
					website: 'https://www.entreprise-gourdon.fr/',
				},
				{
					name: 'SOCIÉTÉ NOUVELLE GARRAUD (SN GARRAUD)',
					website: 'https://www.facebook.com/sng.garraud/',
				},
			]

			// WHEN the notes are read — THEN they still meet. Two different hosts hold
			// a note apart from its name only when each is established as that row's
			// own; a host nobody is named by says nothing about who anybody is
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[1, 0]])
		})

		it('should leave a noted row where only the plain row stands somewhere', () => {
			// GIVEN a plain row at a domain that spells it, and a noted row naming a
			// different address that does not spell anybody
			const rows = [
				{ name: 'Acme', website: 'https://acme.com' },
				{ name: 'Acme (UK)', website: 'https://acme-uk.example' },
			]

			// WHEN the notes are read
			// THEN they stay two rows. One row at a domain of its own beside a row
			// naming a different address is enough to say they are two companies —
			// asking both to establish a site let whichever could not hand the other's
			// claim away
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should leave it whichever of the two stands at a site of its own', () => {
			// GIVEN the same pair the other way round: the NOTED row is the one whose
			// domain spells it, and the plain row sits on a listing
			const rows = [
				{ name: 'Acme', website: 'https://acme-directory.example/acme' },
				{ name: 'Acme (UK)', website: 'https://acme.com' },
			]

			// WHEN the notes are read — THEN still two rows, since which of them can
			// spell its own domain says nothing about whether they are one company
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should read a noted row naming no address as the same company', () => {
			// GIVEN a plain row at a domain that spells it and a noted row with no
			// address at all — the ordinary shape of a scan writing down where it met
			// a company it had already listed
			const rows = [
				{ name: 'DO Chauffage', website: 'https://do-chauffage.fr' },
				{ name: 'DO CHAUFFAGE (UPSswitch entry)' },
			]

			// WHEN the notes are read — THEN they meet. A row naming no address is not
			// standing somewhere else; only a stated, different address is
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[1, 0]])
		})

		it('should leave a noted row standing at a different site of its own', () => {
			// GIVEN two rows each at a domain that spells them
			const rows = [
				{ name: 'Acme', website: 'https://acme.com' },
				{ name: 'Acme (UK)', website: 'https://acme.co.uk' },
			]

			// WHEN the notes are read — THEN two addresses each a company's own is the
			// strongest thing on a row for saying these are two companies, and it
			// outranks a bracket
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it("should read a noted row sharing the plain row's host as the same company", () => {
			// GIVEN a noted row on a page of the plain row's own site
			const rows = [
				{ name: 'Acme', website: 'https://acme.com' },
				{ name: 'Acme (UK)', website: 'https://acme.com/uk' },
			]

			// WHEN the notes are read — THEN one host is no reason to hold them apart
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([[1, 0]])
		})
	})

	describe('when there is no plain name for a note to belong to', () => {
		it('should leave a noted row whose plain name is not on the list', () => {
			// GIVEN a note on a name nothing else carries
			const rows = [{ name: 'Acme (Annuaire entry)' }, { name: 'Beta Energie' }]

			// WHEN the notes are read — THEN the brackets alone fold nothing
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should leave a value that is nothing but a bracketed phrase', () => {
			// GIVEN a "name" that is only a note
			const rows = [{ name: '(Annuaire entry)' }, { name: 'Acme' }]

			// WHEN the notes are read — THEN it names no company for another row to be
			// a second reading of
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should leave a name whose brackets do not close it', () => {
			// GIVEN words written after the brackets rather than the other way round
			const rows = [{ name: 'Acme' }, { name: 'Acme (Paris) Nord' }]

			// WHEN the notes are read — THEN this is a longer name, not a noted one
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should leave a name carrying nothing but a legal form before its note', () => {
			// GIVEN brackets after a name with no company left in it
			const rows = [{ name: 'SARL' }, { name: 'SARL (Annuaire entry)' }]

			// WHEN the notes are read — THEN there is no company to be the same one as
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})
	})

	describe('when a row is not something a note can be read from', () => {
		it('should leave list entries that are not rows alone', () => {
			// GIVEN a list holding something that is not a row
			const rows = ['KBE Energy (Annuaire entry)', null, { name: 'KBE Energy' }]

			// WHEN the notes are read — THEN only rows are read
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should leave a row whose name is not written as text', () => {
			// GIVEN a name that came back as something other than words
			const rows = [{ name: 42 }, { name: 'Acme' }]

			// WHEN the notes are read — THEN nothing is read off it
			expect([
				...bracketedNoteParents(rows, hostsEstablishedAsOwn(rows, noRunWords)),
			]).toEqual([])
		})

		it('should find no notes in an empty list', () => {
			// GIVEN nothing to read
			// WHEN the notes are read — THEN there is nothing to belong to anything
			expect([
				...bracketedNoteParents([], hostsEstablishedAsOwn([], noRunWords)),
			]).toEqual([])
		})
	})
})

describe('hostsEstablishedAsOwn', () => {
	describe('when the run names the trade the rows are called after', () => {
		it('should not read the bare domain of that trade as anybody own', () => {
			// GIVEN two different plumbers, each offering the bare domain of the trade
			// they are named after, in a run that asked for that trade
			const rows = [
				{ name: 'Fontanería García', website: 'https://fontaneria.es' },
				{ name: 'Fontanería López', website: 'https://fontaneria.es' },
			]

			// WHEN the owned hosts are worked out
			// THEN none: fontaneria.es belongs to whoever registered it. Reading it as
			// owned would make it a key both rows share, and two unrelated firms would
			// be folded into one company
			expect(hostsEstablishedAsOwn(rows, runWordsOf(['fontanería']))).toEqual(
				new Set(),
			)
		})

		it('should still read the host of a row that spells its own name', () => {
			// GIVEN the same run and a row at the domain carrying the word only it has
			const rows = [{ name: 'Fontanería García', website: 'https://garcia.es' }]

			// WHEN the owned hosts are worked out — THEN that host is one of them
			expect(hostsEstablishedAsOwn(rows, runWordsOf(['fontanería']))).toEqual(
				new Set(['garcia.es']),
			)
		})
	})

	describe('when the address is paired with the page it was read on', () => {
		it('should read it just the same as a bare one', () => {
			// GIVEN the shape a scan actually returns today — the address and the page
			// it came from together. Read as a bare string, this row establishes no
			// host at all, which is what every scan since the field gained its source
			// has been doing
			const rows = [
				{
					name: 'Fontanería García',
					website: {
						value: 'https://garcia.es',
						source_id: 'https://garcia.es',
						confidence: null,
					},
				},
			]

			// WHEN the owned hosts are worked out — THEN the host is established
			expect(hostsEstablishedAsOwn(rows, runWordsOf(['fontanería']))).toEqual(
				new Set(['garcia.es']),
			)
		})
	})

	describe('when a row stands at the domain that spells it', () => {
		it("should read the host as that company's own", () => {
			// GIVEN a workshop at the domain carrying its name
			const rows = [
				{
					name: 'Fusteria Miquel',
					website: 'https://fusteriamiquel.cat/qui-som',
				},
			]

			// WHEN the owned hosts are worked out — THEN the host is one of them
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(
				new Set(['fusteriamiquel.cat']),
			)
		})

		it('should file the host the way a row files it, with the www off', () => {
			// GIVEN one row writing the address with www and another without
			const rows = [
				{ name: 'SICE', website: 'https://www.sice.com' },
				{
					name: 'Sociedad Ibérica de Construcciones',
					website: 'https://sice.com/es',
				},
			]

			// WHEN the owned hosts are worked out
			// THEN one host, spelled the way the identity keys spell it — otherwise the
			// row that establishes a site and the row that needs it never meet
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(
				new Set(['sice.com']),
			)
		})
	})

	describe('when nothing establishes who a host belongs to', () => {
		it('should not let a note naming a directory pass that directory off as own', () => {
			// GIVEN a row whose name carries a note saying which directory it was met
			// on, standing on that very directory, beside another company listed there
			const rows = [
				{
					name: 'KBE Energy (Annuaire Tecsol entry)',
					website: 'https://annuaire.tecsol.fr/kbe',
				},
				{ name: 'Beta Energie', website: 'https://annuaire.tecsol.fr/beta' },
			]

			// WHEN the hosts are read
			// THEN the directory is nobody's own site. Reading the note as part of the
			// name would have the directory's own words spell the company, and every
			// other firm listed there would then file under it as the same company
			expect([...hostsEstablishedAsOwn(rows, noRunWords)]).toEqual([])
		})

		it('should keep two companies on one directory apart through the fold', () => {
			// GIVEN those same two rows
			const findings = scan([
				{
					name: 'KBE Energy (Annuaire Tecsol entry)',
					website: 'https://annuaire.tecsol.fr/kbe',
				},
				{ name: 'Beta Energie', website: 'https://annuaire.tecsol.fr/beta' },
			])

			// WHEN de-duplicated — THEN both survive, because a shared directory is no
			// evidence that two companies are one
			const result = dedupeDiscoveryRows(findings, 'prospects', noRunWords)
			expect(rowsOf(result.findings)).toHaveLength(2)
			expect(result.merged).toBe(0)
		})

		it('should leave out a host that spells neither company on it', () => {
			// GIVEN two installers on a trade body's member pages
			const rows = [
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
			]

			// WHEN the owned hosts are worked out — THEN there are none
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(new Set())
		})

		it('should leave out a host merely carrying a word of the name', () => {
			// GIVEN a listing site whose own domain happens to open with the name
			const rows = [
				{ name: 'Acme', website: 'https://acme-directory.com/acme' },
			]

			// WHEN the owned hosts are worked out
			// THEN none. A domain has to BE the name, or every listing filed under a
			// company would clear itself as that company's site
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(new Set())
		})

		it('should pass over a row with no name to judge the domain against', () => {
			// GIVEN a row that gives a site and never says whose it is
			const rows = [{ website: 'https://terresolaire.com/' }]

			// WHEN the owned hosts are worked out — THEN nothing is established, which
			// is the answer rather than a missing one
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(new Set())
		})

		it('should pass over a row whose name is empty', () => {
			// GIVEN a row whose name field came back blank
			const rows = [{ name: '   ', website: 'https://terresolaire.com/' }]

			// WHEN the owned hosts are worked out — THEN a blank spells no domain, so
			// the site is left standing for nobody
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(new Set())
		})

		it('should pass over a row whose website is not an address', () => {
			// GIVEN a row answering the website question in words
			const rows = [
				{
					name: 'Terre Solaire',
					website: 'https://terresolaire.com (inferred)',
				},
			]

			// WHEN the owned hosts are worked out — THEN there is no domain to read
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(new Set())
		})

		it('should pass over list entries that are not rows', () => {
			// GIVEN a list holding a null beside a real row
			const rows = [
				null,
				'not a row',
				{ name: 'SICE', website: 'https://sice.com' },
			]

			// WHEN the owned hosts are worked out — THEN only the real row is read
			expect(hostsEstablishedAsOwn(rows, noRunWords)).toEqual(
				new Set(['sice.com']),
			)
		})

		it('should find nothing in an empty list', () => {
			// GIVEN nothing to read
			// WHEN the owned hosts are worked out — THEN there are none
			expect(hostsEstablishedAsOwn([], noRunWords)).toEqual(new Set())
		})
	})
})

describe('isSiteKey', () => {
	describe('when asked which of the two keys joined a pair of rows', () => {
		it('should tell a key filed under a site from one filed under a name', () => {
			// GIVEN the keys a row with both a name and its own site files under
			const keys = discoveryRowIdentityKeys(
				{ name: 'SICE', website: 'https://sice.com' },
				new Set(['sice.com']),
			)

			// WHEN each is asked — THEN only the site key says yes, so a caller can
			// count the joins a website made without taking a key apart itself
			expect(keys.map(isSiteKey)).toEqual([false, true])
		})
	})
})
