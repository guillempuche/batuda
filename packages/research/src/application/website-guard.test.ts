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

describe('guardCompanyWebsites', () => {
	describe('when the website is a known directory', () => {
		it('should blank a company-profile page and count it as a directory', () => {
			// GIVEN a competitor whose "website" is a CB Insights profile page
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://www.cbinsights.com/company/redwood-logistics',
				},
			])

			// WHEN the websites are checked
			const result = guardCompanyWebsites(findings)

			// THEN the directory URL is removed and the reason is recorded
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
			expect(result.blankedProfilePage).toBe(0)
		})

		it('should blank a page on a subdomain of a known directory', () => {
			// GIVEN a research subdomain of a listed aggregator
			const findings = scan([
				{
					name: 'Acme Freight',
					website: 'https://research.owler.com/company/acme',
				},
			])

			// WHEN checked — THEN the subdomain is treated as the directory it is
			const result = guardCompanyWebsites(findings)
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedDirectory).toBe(1)
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

			// WHEN checked — THEN the missing scheme does not hide the directory
			const result = guardCompanyWebsites(findings)
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
		it('should blank a known directory even with no name to compare', () => {
			// GIVEN the profile's website field pointing at an aggregator listing
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
			const result = guardCompanyWebsites(findings)

			// THEN the known-directory rule still fires, which is the whole point
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
