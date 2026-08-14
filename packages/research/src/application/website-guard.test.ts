import { describe, expect, it } from 'vitest'

import { guardCompanyWebsites } from './website-guard'

// A competitor/prospect entry: a name plus the website the model returned for it.
const scan = (
	competitors: ReadonlyArray<{ name: string; website?: string }>,
) => ({
	competitors,
})

const websitesOf = (findings: unknown): Array<string | undefined> =>
	(findings as { competitors: Array<{ website?: string }> }).competitors.map(
		c => c.website,
	)

// A prospect row the way a scan really returns one: a name, the website the model
// gave for it, and the sources it cited for the company.
const cited = (
	rows: ReadonlyArray<{
		name: string
		website?: string
		sources?: ReadonlyArray<unknown>
	}>,
) => ({
	prospects: rows.map(({ name, website, sources }) => ({
		name,
		...(website === undefined ? {} : { website }),
		citations: (sources ?? []).map(source =>
			typeof source === 'string'
				? { source_id: source, confidence: 0.6 }
				: source,
		),
	})),
})

const prospectWebsites = (findings: unknown): Array<string | undefined> =>
	(findings as { prospects: Array<{ website?: string }> }).prospects.map(
		p => p.website,
	)

// The address the French solar directory files a company at: a slug naming a trade
// and a role, ending in the listing's own record number, and naming no company.
const TECSOL_LISTING =
	'https://annuaire.tecsol.fr/liste-fournisseur-solaire-installateurs-epc-339615/'

describe('guardCompanyWebsites', () => {
	describe('when the run watched the host file several of its companies', () => {
		it('should blank the website and count it as a directory', () => {
			// GIVEN a company whose "website" is its page on a host the run itself
			// judged a listing, filed under a name the address does not spell out
			const findings = scan([
				{ name: 'Acme Freight', website: 'https://research.owler.com/c/8812' },
			])

			// WHEN the websites are checked against what the run observed
			const result = guardCompanyWebsites(
				findings,
				undefined,
				new Set(['research.owler.com']),
			)

			// THEN the listing is removed, which the rules reading only this one
			// address could not have done: nothing here names the company
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
			expect(result.blankedProfilePage).toBe(0)
		})

		it('should leave a host the run never watched alone', () => {
			// GIVEN the same address, with the run having observed a different host
			const findings = scan([
				{ name: 'Acme Freight', website: 'https://research.owler.com/c/8812' },
			])

			// WHEN checked
			const result = guardCompanyWebsites(
				findings,
				undefined,
				new Set(['aemiat.com']),
			)

			// THEN it is kept: an unwatched host is unknown, and unknown is no reason
			// to take a website away
			expect(websitesOf(result.findings)).toEqual([
				'https://research.owler.com/c/8812',
			])
			expect(result.blankedDirectory).toBe(0)
		})

		it('should still blank a profile page with nothing observed at all', () => {
			// GIVEN a directory's page about the company, and a run that watched
			// nothing — a resume, or a run whose searches met each host once
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://www.cbinsights.com/company/redwood-logistics',
				},
			])

			// WHEN checked with no observation to go on
			const result = guardCompanyWebsites(findings)

			// THEN the address naming the company one level down is enough on its
			// own, so losing the list of known directories costs this case nothing
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
			expect(result.blankedDirectory).toBe(0)
		})
	})

	describe('when the website is an unknown host with the name in a deeper path', () => {
		it('should blank it as a profile page — the listing shape, no list needed', () => {
			// GIVEN a directory nobody put on the known list, filing the company one
			// level down
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website:
						'https://some-unknown-directory.io/company/redwood-logistics',
				},
			])

			// WHEN checked — THEN it is still caught, by the address shape alone
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
			expect(result.blankedDirectory).toBe(0)
		})

		it('should find a name the address writes with escaped accents', () => {
			// GIVEN a Spanish directory filing a company whose name carries an accent,
			// which the address spells as an escape the way such a site does
			const findings = scan([
				{
					name: 'Grupo Muñoz',
					website: 'https://directorio.es/empresa/grupo-mu%C3%B1oz',
				},
			])

			// WHEN checked
			// THEN it is caught. The address is put back into letters before the name is
			// looked for, so the escaping does not hide the listing — and a run over a
			// Spanish or Catalan market meets this spelling constantly
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
		})

		it('should read a part whose escaping was never valid as it stands', () => {
			// GIVEN a listing path carrying a stray percent sign, which is not escaping
			// anything
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://dir.example/empresa/redwood-logistics%zz',
				},
			])

			// WHEN checked — THEN the part is read as written rather than thrown away,
			// so a path that was never valid escaping still gets judged
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
		})

		it('should not let an escaped slash invent a deeper part', () => {
			// GIVEN a company's own first-level page whose name holds an escaped slash
			const findings = scan([
				{
					name: 'XPO Logistics',
					website: 'https://xpo.com/about%2Fxpo-logistics',
				},
			])

			// WHEN checked
			// THEN it stands. The address has one part, and putting it back into letters
			// must not split it into two — read the other way round, the name would land
			// in a "deeper" part that the address never had, and the company would lose
			// its own page
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://xpo.com/about%2Fxpo-logistics',
			])
			expect(result.blankedProfilePage).toBe(0)
		})

		it('should blank one even when the company name is short', () => {
			// GIVEN a three-letter company filed under a directory path
			const findings = scan([
				{ name: 'DSV', website: 'https://crunchbase.com/organization/dsv' },
			])

			// WHEN checked — THEN a short name is no reason to let a listing through
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
		})
	})

	describe('when the company legal form leads its name', () => {
		it('should still catch a listing that files it under its trading name', () => {
			// GIVEN a French company whose form opens the name, on a directory that
			// files it under the trading name alone
			const findings = scan([
				{
					name: 'SARL Transports Dupont',
					website: 'https://dir.example/company/transports-dupont',
				},
			])

			// WHEN checked
			// THEN it is blanked. A directory writes the trading name and leaves the
			// form out, so the name is matched with every form taken out wherever it
			// sits — which is a looser question than who the company is, and the safe
			// direction for a guard whose job is spotting listings
			expect(websitesOf(guardCompanyWebsites(findings).findings)).toEqual([
				undefined,
			])
		})
	})

	describe('when the website is the company own site', () => {
		it('should keep a host that carries the company name', () => {
			// GIVEN the company's own domain
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://redwoodlogistics.com/about',
				},
			])

			// WHEN checked — THEN it is left untouched
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://redwoodlogistics.com/about',
			])
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})

		it('should keep a name that sits in the first path segment', () => {
			// GIVEN a company describing itself on its own site, name in segment one
			const findings = scan([
				{
					name: 'XPO Logistics',
					website: 'https://xpo.com/about-xpo-logistics',
				},
			])

			// WHEN checked — THEN a first-segment mention is a company describing
			// itself, not a directory filing it away
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://xpo.com/about-xpo-logistics',
			])
		})

		it('should keep a short host that does not spell out the whole name', () => {
			// GIVEN a company whose own domain does not contain its full name
			const findings = scan([
				{ name: 'Penske Logistics', website: 'https://gopenske.com/logistics' },
			])

			// WHEN checked — THEN it is kept: the name is in no deeper path segment
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://gopenske.com/logistics',
			])
		})

		it('should keep a bare host with no path at all', () => {
			// GIVEN a plain domain
			const findings = scan([{ name: 'DSV', website: 'https://dsv.com' }])

			// WHEN checked — THEN nothing to file it away, so it stays
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual(['https://dsv.com'])
		})

		it('should keep an own-site path even when the name repeats in it', () => {
			// GIVEN a host that names the company AND repeats it in a deeper path
			const findings = scan([
				{
					name: 'Acme Logistics',
					website: 'https://acmelogistics.com/company/acme-logistics',
				},
			])

			// WHEN checked — THEN the host naming the company is the deciding signal
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://acmelogistics.com/company/acme-logistics',
			])
		})
	})

	describe('when the website is a scheme-less host', () => {
		it('should classify it the same as one with a scheme', () => {
			// GIVEN a tidied bare host on a directory
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'cbinsights.com/company/redwood-logistics',
				},
			])

			// WHEN checked — THEN the missing scheme does not hide the listing
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
		})

		it('should match an observed host with no scheme written', () => {
			// GIVEN a bare host the run judged a listing, filed under an address that
			// names nobody
			const findings = scan([
				{ name: 'Acme Freight', website: 'owler.com/c/8' },
			])

			// WHEN checked — THEN the observed verdict is found without a scheme too
			const result = guardCompanyWebsites(
				findings,
				undefined,
				new Set(['owler.com']),
			)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
		})
	})

	describe('when the input is degenerate', () => {
		it('should blank a website that is not a URL at all', () => {
			// GIVEN a website that is not a URL at all
			const findings = scan([{ name: 'Acme', website: 'not a url' }])

			// WHEN checked — THEN it goes: a website field nobody can open is worse
			// than an empty one, because it reads as a real site downstream
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedNotAnAddress).toBe(1)
		})

		it('should keep a website when the name is empty', () => {
			// GIVEN a nameless entry — nothing to match a host or path against
			const findings = scan([
				{ name: '', website: 'https://some-directory.io/company/acme' },
			])

			// WHEN checked — THEN it cannot be judged, so it stays
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://some-directory.io/company/acme',
			])
		})

		it('should pass through an entry with a name but no website', () => {
			// GIVEN a competitor the model gave no website
			const findings = scan([{ name: 'Acme Logistics' }])

			// WHEN checked — THEN nothing to blank, and it is unchanged
			const result = guardCompanyWebsites(findings)
			expect(result).toEqual({
				findings,
				blankedNotAnAddress: 0,
				blankedDirectory: 0,
				blankedProfilePage: 0,
				blankedSharedHost: 0,
				blankedReadPage: 0,
			})
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN checked — THEN they pass straight through
			expect(guardCompanyWebsites(null).findings).toBeNull()
			expect(guardCompanyWebsites('text').findings).toBe('text')
			expect(guardCompanyWebsites([1, 2]).findings).toEqual([1, 2])
		})
	})

	describe('when the same shape appears under a different schema', () => {
		it('should blank a prospect website the same way as a competitor one', () => {
			// GIVEN a prospect (not a competitor) carrying a directory URL
			const findings = {
				prospects: [
					{
						name: 'Redwood Logistics',
						website: 'https://cbinsights.com/company/redwood-logistics',
					},
				],
			}

			// WHEN checked — THEN the walk fires on the shape, not the schema name
			const result = guardCompanyWebsites(findings)
			expect(
				(result.findings as { prospects: Array<{ website?: string }> })
					.prospects[0]?.website,
			).toBeUndefined()
		})
	})

	describe('when the run answers with the target company own website', () => {
		it('should blank an observed directory even with no name to compare', () => {
			// GIVEN the profile's website field pointing at a listing the run watched
			const findings = {
				enrichment: {
					website: {
						value: 'https://www.crunchbase.com/organization/acme',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked with no target name supplied
			const result = guardCompanyWebsites(
				findings,
				undefined,
				new Set(['crunchbase.com']),
			)

			// THEN the directory rule still fires, which is the whole point: it is the
			// one rule that needs no name beside the address
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedDirectory).toBe(1)
		})

		it('should blank a listing on an unknown host once the target name is known', () => {
			// GIVEN a directory we do not list, filing the company one level down
			const findings = {
				enrichment: {
					website: {
						value: 'https://empresas.example.org/company/redwood-logistics',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked against the company the run is about
			const result = guardCompanyWebsites(findings, 'Redwood Logistics')

			// THEN the name-in-a-deeper-path rule catches it
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedProfilePage).toBe(1)
		})

		it('should keep the company own site', () => {
			// GIVEN the company's real website
			const website = {
				value: 'https://redwoodlogistics.com/about',
				source_id: 'src_a',
				confidence: null,
			}
			const findings = { enrichment: { website } }

			// WHEN checked against the company the run is about
			const result = guardCompanyWebsites(findings, 'Redwood Logistics')

			// THEN the host carries the name, so it stands
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toEqual(website)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})

		it('should blank the answer when it is the page it was read from', () => {
			// GIVEN the profile's website field holding a listing page, with the source
			// beside it naming that same page — the field is its own citation list
			const findings = {
				enrichment: {
					website: {
						value: TECSOL_LISTING,
						source_id: TECSOL_LISTING,
						confidence: null,
					},
				},
			}

			// WHEN checked against the company the run is about
			const result = guardCompanyWebsites(findings, 'KBE Energy')

			// THEN the same reading reaches the field that arrives alone: nothing in
			// the address names the company, and its source is the address itself
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedReadPage).toBe(1)
		})

		it('should blank the target own deep page when nothing names it — the cost', () => {
			// GIVEN a real company page on a domain that spells no part of its name, read
			// and recorded as the one page behind the answer
			const url = 'https://gd-holding.fr/qui-sommes-nous'
			const findings = {
				enrichment: {
					website: { value: url, source_id: url, confidence: null },
				},
			}

			// WHEN checked against the company the run is about
			const result = guardCompanyWebsites(findings, 'Groupe Dupont SA')

			// THEN it goes, and this is the price of the rule rather than a bug: the
			// field carries one source and can never carry a second, so nothing here can
			// tell this apart from a listing page recorded the same way. Pinned so the
			// cost stays visible instead of being discovered in a run
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedReadPage).toBe(1)
		})

		it('should keep the answer when it was read from another page', () => {
			// GIVEN the run's answer for the target's site, read from a page elsewhere
			const website = {
				value: 'https://kbe-groupe.example/nos-activites',
				source_id: 'https://www.lemoniteur.fr/kbe-energy',
				confidence: null,
			}
			const findings = { enrichment: { website } }

			// WHEN checked — THEN the address is not where the claim came from, so this
			// rule has nothing to say about it
			const result = guardCompanyWebsites(findings, 'KBE Energy')
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toEqual(website)
			expect(result.blankedReadPage).toBe(0)
		})

		it('should leave a competitor website judged against its own name', () => {
			// GIVEN a competitor entry whose site is its own, beside a target name
			// that has nothing to do with it
			const findings = {
				competitors: [
					{ name: 'Rival Freight', website: 'https://rivalfreight.com' },
				],
			}

			// WHEN checked while the run is about a different company
			const result = guardCompanyWebsites(findings, 'Redwood Logistics')

			// THEN the pair rule wins for a named company, so the site is kept
			expect(result.findings).toEqual(findings)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})
	})

	describe('when the value is not a web address', () => {
		it('should blank a website with an aside written next to it', () => {
			// GIVEN the two shapes a scan actually came back with: an address with the
			// model's own note glued on the end
			const findings = scan([
				{
					name: 'ADIME',
					website:
						'https://adime.org/ (not directly provided, inferred from name)',
				},
				{
					name: 'SEA Empresas Alavesas',
					website: 'https://sea.es/ (derived from SEA Empresas Alavesas page)',
				},
			])

			// WHEN checked
			// THEN both go. The parser folds the trailing words into the path and hands
			// back a clean host, so nothing that reads the host alone can catch this
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined, undefined])
			expect(result.blankedNotAnAddress).toBe(2)
		})

		it('should keep an address whose spaces are properly escaped', () => {
			// GIVEN a real page whose path holds an escaped space
			const findings = scan([
				{ name: 'Acme', website: 'https://acme.es/quienes%20somos' },
			])

			// WHEN checked — THEN it is one address and nothing else, so it stands
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://acme.es/quienes%20somos',
			])
		})

		it("should blank the run's own answer for the target when it carries an aside", () => {
			// GIVEN the profile's website field holding an address plus a note
			const findings = {
				enrichment: {
					website: {
						value: 'https://acme.es (inferred from the company name)',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked — THEN the same rule reaches the field that arrives alone
			const result = guardCompanyWebsites(findings, 'Acme')
			expect(
				(result.findings as { enrichment: Record<string, unknown> }).enrichment[
					'website'
				],
			).toBeNull()
			expect(result.blankedNotAnAddress).toBe(1)
		})
	})

	describe('when several companies in one answer claim the same host', () => {
		it('should blank a trade body member-directory page given as a company site', () => {
			// GIVEN four installers each handed the page an association gives them in
			// its member list, at the top level of the association's own host
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
				{ name: 'Montajes Tejero', website: 'https://aemiat.com/tejero/' },
				{ name: 'Clima Alavesa', website: 'https://aemiat.com/clima-alavesa/' },
			])

			// WHEN checked
			// THEN all four go. The listing sits in the first path segment, which the
			// deeper-path rule deliberately exempts — what settles it is that one host
			// cannot be four different companies' own site
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				undefined,
				undefined,
				undefined,
				undefined,
			])
			expect(result.blankedSharedHost).toBe(4)
		})

		it('should keep a company describing itself in the first path segment', () => {
			// GIVEN the shape the first-segment exemption exists to protect: companies
			// whose own site describes them right there
			const findings = scan([
				{
					name: 'XPO Logistics',
					website: 'https://xpo.com/about-xpo-logistics',
				},
				{ name: 'SEUR', website: 'https://seur.com/sobre-seur' },
				{ name: 'DSV', website: 'https://dsv.com/about-dsv' },
				{
					name: 'GLS Spain',
					website: 'https://gls-spain.es/gls-spain-quienes',
				},
			])

			// WHEN checked — THEN every one stands: each host carries its own company's
			// name, and no host is claimed by anybody else
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://xpo.com/about-xpo-logistics',
				'https://seur.com/sobre-seur',
				'https://dsv.com/about-dsv',
				'https://gls-spain.es/gls-spain-quienes',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should stand down entirely once the host names one of the claimants', () => {
			// GIVEN a company's own site, handed to a differently-named row as well
			const findings = scan([
				{ name: 'Acme SL', website: 'https://acme.es' },
				{ name: 'Instalaciones Rubio', website: 'https://acme.es/rubio' },
			])

			// WHEN checked
			// THEN both keep it, including the row the host does not name. From the
			// addresses alone this is the same shape as one company met under two
			// names, and blanking on the difference would blank that case too — so a
			// host that belongs to somebody here takes this rule out of play, and what
			// the two rows are to each other is settled by the de-duplication after it
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://acme.es',
				'https://acme.es/rubio',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should keep a site the host names, for every row claiming it', () => {
			// GIVEN one company met twice — under its trade name and its legal one —
			// both correctly citing the site the trade name is in
			const findings = scan([
				{ name: 'SICE', website: 'https://www.sice.com' },
				{
					name: 'Sociedad Ibérica de Construcciones Eléctricas',
					website: 'https://sice.com/es',
				},
			])

			// WHEN checked
			// THEN both keep it. The host plainly belongs to somebody in the list, so
			// this is one company met twice rather than a directory — and the shared
			// site is the only thing that says the two rows are the same company, so
			// blanking it would leave them as two
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://www.sice.com',
				'https://sice.com/es',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should keep a host only one company in the answer claims', () => {
			// GIVEN a single company on a host nobody else gives
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Montajes Tejero', website: 'https://tejero.es' },
			])

			// WHEN checked
			// THEN it stands: one row claiming a host is not evidence the host is
			// somebody else's, and a blank costs a real website
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([
				'https://aemiat.com/e-mora/',
				'https://tejero.es',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should still report a listing shape as the profile page it is', () => {
			// GIVEN two companies filed one level down on a shared directory host
			const findings = scan([
				{ name: 'Acme', website: 'https://directorio.es/empresa/acme' },
				{
					name: 'Beta Instal',
					website: 'https://directorio.es/empresa/beta-instal',
				},
			])

			// WHEN checked — THEN the more exact diagnosis wins, so the counters keep
			// telling apart a listing from a host several rows merely share
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined, undefined])
			expect(result.blankedProfilePage).toBe(2)
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should not count a person website in a proposal as a claim on the host', () => {
			// GIVEN a company on a host, and a contact proposal naming the same host
			const findings = {
				prospects: [{ name: 'Acme', website: 'https://acme.es' }],
				proposed_updates: [
					{
						operation: 'create',
						fields: { name: 'Ada Lovelace', website: 'https://acme.es/ada' },
					},
				],
			}

			// WHEN checked — THEN the proposal subtree is skipped when the claims are
			// gathered too, so a person never costs a company its site
			const result = guardCompanyWebsites(findings)
			expect(
				(result.findings as { prospects: Array<{ website?: string }> })
					.prospects[0]?.website,
			).toBe('https://acme.es')
			expect(result.blankedSharedHost).toBe(0)
		})
	})

	describe('when the website is the page the row claim was read from', () => {
		it('should blank a listing page that names the company nowhere', () => {
			// GIVEN a French solar directory's listing page handed back as a company's
			// own website, cited as the one page the company was read on — the shape
			// every other rule here misses: one company on the host, and a slug in the
			// first path segment that names a trade instead of a company
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [TECSOL_LISTING],
				},
			])

			// WHEN checked
			const result = guardCompanyWebsites(findings)

			// THEN the address goes: nothing in it names the company, and its own
			// citation says only that the run read the page
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedReadPage).toBe(1)
			// AND no other rule claims it, so the counters stay diagnostic
			expect(
				result.blankedDirectory +
					result.blankedProfilePage +
					result.blankedSharedHost +
					result.blankedNotAnAddress,
			).toBe(0)
		})

		it('should leave the rest of the row it blanks alone', () => {
			// GIVEN the same row, carrying the fields that are not the website
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [TECSOL_LISTING],
				},
			])

			// WHEN checked
			// THEN only the website key is dropped — the company and its evidence stay,
			// because what was wrong was the address, not the company
			expect(guardCompanyWebsites(findings).findings).toEqual({
				prospects: [
					{
						name: 'KBE Energy',
						citations: [{ source_id: TECSOL_LISTING, confidence: 0.6 }],
					},
				],
			})
		})

		it('should keep a company own site read from that very page', () => {
			// GIVEN the ordinary case this rule must never touch: a company's own site,
			// with the run having read the claim from that same page
			const own = 'https://redwoodlogistics.com/about-us'
			const findings = cited([
				{ name: 'Redwood Logistics', website: own, sources: [own] },
			])

			// WHEN checked — THEN the host carries the name, which settles it long
			// before the page it was read from is asked about
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([own])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should keep an about-us page in the first segment read from itself', () => {
			// GIVEN the exemption that protects the large carriers: a company
			// describing itself in the first path segment of its own host, cited as the
			// page it was read on
			const own = 'https://xpo.com/about-xpo-logistics'
			const findings = cited([
				{ name: 'XPO Logistics', website: own, sources: [own] },
			])

			// WHEN checked
			// THEN it stands. The host names nobody and the page is the one that was
			// read, so what separates this from the listing above is the single thing
			// this rule adds: the first segment spells the company out
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([own])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should keep a host carrying one distinctive word of the name', () => {
			// GIVEN a company whose own domain holds part of its name rather than all
			// of it, on the page the claim was read from
			const own = 'https://gopenske.com/logistics'
			const findings = cited([
				{ name: 'Penske Logistics', website: own, sources: [own] },
			])

			// WHEN checked — THEN one distinctive word inside the host is a mention,
			// and a mention anywhere withholds the blank
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([own])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should keep a bare host even when that is the page that was read', () => {
			// GIVEN a plain host given as a website and cited as the page read, naming
			// the company nowhere
			const findings = cited([
				{
					name: 'KBE Energy',
					website: 'https://annuaire.tecsol.fr',
					sources: ['https://annuaire.tecsol.fr'],
				},
			])

			// WHEN checked
			// THEN it stays. With no path there is no page to tell apart from the site,
			// so the tell this rule reads is absent and what is left is the ordinary
			// case — a run that read a home page and wrote the site down
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([
				'https://annuaire.tecsol.fr',
			])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should keep a page whose accented name the address writes as escapes', () => {
			// GIVEN a company's own page filed under its accented name, which the
			// address spells in escapes the way a Spanish or Catalan site does
			const own = 'https://serveis.example/grupo-mu%C3%B1oz'
			const findings = cited([
				{ name: 'Grupo Muñoz', website: own, sources: [own] },
			])

			// WHEN checked — THEN the name is found through the escaping, so the page
			// is read as naming the company and kept
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([own])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should blank when every citation the row has is that one page', () => {
			// GIVEN a row citing the listing page three times, once per quote it took
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [TECSOL_LISTING, TECSOL_LISTING, TECSOL_LISTING],
				},
			])

			// WHEN checked — THEN the same page cited repeatedly is still one page, and
			// still the only thing that mentioned the company
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedReadPage).toBe(1)
		})

		it('should keep the address when another source mentions the company too', () => {
			// GIVEN a row backed by a second, separate page as well
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [TECSOL_LISTING, 'https://www.lemoniteur.fr/kbe-energy'],
				},
			])

			// WHEN checked
			// THEN it stands. This rule speaks only for a row whose whole evidence is
			// the address itself; once something else has mentioned the company, what
			// the address is stops being a question this rule can answer
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should keep an address the row cites nothing at all for', () => {
			// GIVEN the same listing address on a row with no citations
			const findings = cited([
				{ name: 'KBE Energy', website: TECSOL_LISTING, sources: [] },
			])

			// WHEN checked — THEN a row citing nothing says nothing either way, so
			// there is no provenance to read and the address is left alone
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should read a citation written without a scheme as the same page', () => {
			// GIVEN the website with its scheme and the citation without one, and a
			// trailing slash on only one of the two
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [
						'annuaire.tecsol.fr/liste-fournisseur-solaire-installateurs-epc-339615',
					],
				},
			])

			// WHEN checked — THEN the two spellings are one page, so tidying the
			// citation does not hide where the claim came from
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedReadPage).toBe(1)
		})

		it('should read past a tracking parameter on the citation', () => {
			// GIVEN the citation carrying the parameters of the link that reached it
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [`${TECSOL_LISTING}?utm_source=serp`],
				},
			])

			// WHEN checked — THEN a page is the same page whichever link led to it
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedReadPage).toBe(1)
		})

		it('should keep an address cited at the same path on another host', () => {
			// GIVEN a citation whose path matches but whose host does not
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [
						'https://autre-annuaire.fr/liste-fournisseur-solaire-installateurs-epc-339615/',
					],
				},
			])

			// WHEN checked — THEN a matching path on a different site is a different
			// page, so the website is not where the claim came from
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should keep an address whose only citation is an internal source id', () => {
			// GIVEN a row citing a page by the id the run stored it under
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: ['src_9f2a1b3c4d5e6f70'],
				},
			])

			// WHEN checked
			// THEN nothing fires: an opaque id names no host, so it can neither match
			// the address nor be mistaken for it. The rule reads a citation only when
			// the model wrote it as the address it is
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should skip a citation entry that names no source', () => {
			// GIVEN a row whose citations are a quote with no source beside it and the
			// listing page itself
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [
						{ quote: 'KBE Energy, installateur EPC', confidence: 0.4 },
						TECSOL_LISTING,
					],
				},
			])

			// WHEN checked — THEN an entry naming no source has mentioned the company
			// nowhere, so it neither counts as another source nor blocks the rule
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedReadPage).toBe(1)
		})

		it('should keep an address on a row whose citations are not a list', () => {
			// GIVEN a malformed row whose `citations` is a string
			const findings = {
				prospects: [
					{
						name: 'KBE Energy',
						website: TECSOL_LISTING,
						citations: 'annuaire.tecsol.fr',
					},
				],
			}

			// WHEN checked — THEN there is no citation to read, so the row is judged
			// with nothing and its address stands
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should report a host several rows claim as the shared host it is', () => {
			// GIVEN two companies each given their page on a trade body's host, each
			// citing the page it was read on
			const findings = cited([
				{
					name: 'Electricidad Mora',
					website: 'https://aemiat.com/e-mora/',
					sources: ['https://aemiat.com/e-mora/'],
				},
				{
					name: 'Instalaciones Rubio',
					website: 'https://aemiat.com/rubio/',
					sources: ['https://aemiat.com/rubio/'],
				},
			])

			// WHEN checked — THEN both go, counted under the rule that knows more about
			// why: several rows claiming one host says it belongs to none of them
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([undefined, undefined])
			expect(result.blankedSharedHost).toBe(2)
			expect(result.blankedReadPage).toBe(0)
		})

		it('should report a listing shape as the profile page it is', () => {
			// GIVEN a directory filing the company one level down, cited as the page
			// the claim was read from
			const listing = 'https://directorio.es/empresa/acme-instal'
			const findings = cited([
				{ name: 'Acme Instal', website: listing, sources: [listing] },
			])

			// WHEN checked — THEN the address shape is the more exact diagnosis and
			// keeps the count
			const result = guardCompanyWebsites(findings)
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
			expect(result.blankedReadPage).toBe(0)
		})
	})

	describe('when a proposed update carries a person name and a website', () => {
		it('should not match a contact name against a host', () => {
			// GIVEN a create proposal whose fields hold a PERSON's name and a site
			const findings = {
				proposed_updates: [
					{
						operation: 'create',
						fields: {
							name: 'Ada Lovelace',
							website: 'https://cbinsights.com/person/ada-lovelace',
						},
					},
				],
			}

			// WHEN checked — THEN the proposed-updates subtree is left untouched, so a
			// person's website is never blanked as if it were a company's
			const result = guardCompanyWebsites(findings)
			expect(result.findings).toEqual(findings)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})
	})
})
