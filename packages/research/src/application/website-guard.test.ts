import { describe, expect, it } from 'vitest'

import { mergePerFieldSearch } from './per-field-search'
import { tradeWordsOf } from './trade-words'
import { guardCompanyWebsites } from './website-guard'

// A run that named no trades, which is a request about one company on file.
const noTrades = tradeWordsOf([])

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
	describe('when the run names the trade a company is called after', () => {
		it('should count its trade domain as vouching for nobody', () => {
			// GIVEN a firm whose name is nothing but its trade, at the bare domain of
			// that trade, in a run that asked for that trade
			const findings = scan([
				{
					name: 'Services et installations électriques',
					website: 'https://services-et-installations-electriques.com',
				},
			])

			// WHEN checked with the trades the run went looking for
			const result = guardCompanyWebsites({
				findings,
				tradeWords: tradeWordsOf(['installations électriques']),
			})

			// THEN the website is kept — nothing here condemns it — but nothing
			// establishes it either, so it vouches for no company
			expect(websitesOf(result.findings)).toEqual([
				'https://services-et-installations-electriques.com',
			])
			expect(result.ownSiteEstablished).toBe(0)
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should still vouch for the same firm at its own name domain', () => {
			// GIVEN the same run and a firm at the domain spelling the word only it has
			const findings = scan([
				{ name: 'Fontanería García', website: 'https://garcia.es' },
			])

			// WHEN checked — THEN its own site is established and counted
			const result = guardCompanyWebsites({
				findings,
				tradeWords: tradeWordsOf(['fontanería']),
			})

			expect(result.ownSiteEstablished).toBe(1)
			expect(result.ownSiteUnknown).toBe(0)
		})
	})

	describe('when the run watched the host file several of its companies', () => {
		it('should blank the website and count it as a directory', () => {
			// GIVEN a company whose "website" is its page on a host the run itself
			// judged a listing, filed under a name the address does not spell out
			const findings = scan([
				{ name: 'Acme Freight', website: 'https://research.owler.com/c/8812' },
			])

			// WHEN the websites are checked against what the run observed
			const result = guardCompanyWebsites({
				findings,
				directorySites: new Set(['research.owler.com']),
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({
				findings,
				directorySites: new Set(['aemiat.com']),
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })

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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			expect(
				websitesOf(
					guardCompanyWebsites({ findings, tradeWords: noTrades }).findings,
				),
			).toEqual([undefined])
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://gopenske.com/logistics',
			])
		})

		it('should keep a bare host with no path at all', () => {
			// GIVEN a plain domain
			const findings = scan([{ name: 'DSV', website: 'https://dsv.com' }])

			// WHEN checked — THEN nothing to file it away, so it stays
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({
				findings,
				directorySites: new Set(['owler.com']),
				tradeWords: noTrades,
			})
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedNotAnAddress).toBe(1)
		})

		it('should keep a website when the name is empty', () => {
			// GIVEN a nameless entry — nothing to match a host or path against
			const findings = scan([
				{ name: '', website: 'https://some-directory.io/company/acme' },
			])

			// WHEN checked — THEN it cannot be judged, so it stays
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://some-directory.io/company/acme',
			])
		})

		it('should pass through an entry with a name but no website', () => {
			// GIVEN a competitor the model gave no website
			const findings = scan([{ name: 'Acme Logistics' }])

			// WHEN checked — THEN nothing to blank, and it is unchanged. There is no
			// address to establish anything about either, so neither ownership count
			// moves: a row with no website is not a row whose website is unvouched for
			// AND nothing is claimed, since a row with no address claims no host
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result).toEqual({
				findings,
				blankedNotAnAddress: 0,
				blankedSocialPage: 0,
				blankedDirectory: 0,
				blankedProfilePage: 0,
				blankedSharedHost: 0,
				blankedReadPage: 0,
				ownSiteEstablished: 0,
				ownSiteUnknown: 0,
				namedNobodyInParticular: 0,
				hostClaims: new Map(),
			})
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN checked — THEN they pass straight through
			expect(
				guardCompanyWebsites({ findings: null, tradeWords: noTrades }).findings,
			).toBeNull()
			expect(
				guardCompanyWebsites({ findings: 'text', tradeWords: noTrades })
					.findings,
			).toBe('text')
			expect(
				guardCompanyWebsites({ findings: [1, 2], tradeWords: noTrades })
					.findings,
			).toEqual([1, 2])
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({
				findings,
				directorySites: new Set(['crunchbase.com']),
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'Redwood Logistics',
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'Redwood Logistics',
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'KBE Energy',
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'Groupe Dupont SA',
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'KBE Energy',
				tradeWords: noTrades,
			})
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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'Redwood Logistics',
				tradeWords: noTrades,
			})

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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([undefined, undefined])
			expect(result.blankedNotAnAddress).toBe(2)
		})

		it('should keep an address whose spaces are properly escaped', () => {
			// GIVEN a real page whose path holds an escaped space
			const findings = scan([
				{ name: 'Acme', website: 'https://acme.es/quienes%20somos' },
			])

			// WHEN checked — THEN it is one address and nothing else, so it stands
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({
				findings,
				targetName: 'Acme',
				tradeWords: noTrades,
			})
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://www.sice.com',
				'https://sice.com/es',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should stand down for a domain spelling the front of a claimant name', () => {
			// GIVEN one company met under two names on the domain it registered, which
			// is the front of one of those names and carries neither of them whole
			const findings = scan([
				{ name: 'XPO Logistics', website: 'https://xpo.com' },
				{ name: 'XPO Iberia', website: 'https://xpo.com/es' },
			])

			// WHEN checked
			// THEN both keep it. A firm registers the front of its name or the one word
			// people use it by, so asking only whether the host carries a name whole
			// would read a company's own domain as a stranger's and take it from both
			// rows
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://xpo.com',
				'https://xpo.com/es',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should keep a site claimed by one company written two ways', () => {
			// GIVEN one firm on its own site, written with a word in front of its name
			// on one row and without it on the other, on a domain naming a trade
			// rather than the firm
			const findings = scan([
				{ name: 'SIMIE', website: 'https://www.securiteincendie.fr/' },
				{ name: 'Groupe SIMIE', website: 'https://www.securiteincendie.fr/' },
			])

			// WHEN checked
			// THEN both keep it. The rule counts different companies, and these are one
			// company met twice — nothing about the address says otherwise, and reading
			// the two writings as two firms would take a company's own site off both of
			// its rows
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://www.securiteincendie.fr/',
				'https://www.securiteincendie.fr/',
			])
			expect(result.blankedSharedHost).toBe(0)
		})

		it('should keep one page two differently-named rows both point at', () => {
			// GIVEN a firm on the site it publishes, whose domain names the trade it
			// works in rather than the firm, with a second row naming that trade and
			// pointing at the very same page
			const findings = scan([
				{
					name: 'France SAV Solaire',
					website: 'https://www.sav-onduleur-photovoltaique.com',
				},
				{
					name: 'SAV Photovoltaïque',
					website: 'https://www.sav-onduleur-photovoltaique.com/',
				},
			])

			// WHEN checked
			// THEN both stand. A host that files companies gives each of them a page of
			// its own; one page written down twice says nothing about who owns the
			// host, and the two names share no word for the rule to read them as one
			// company either — so the only thing left is that the site is somebody's
			// and a blank would take it from them
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://www.sav-onduleur-photovoltaique.com',
				'https://www.sav-onduleur-photovoltaique.com/',
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(
				(result.findings as { prospects: Array<{ website?: string }> })
					.prospects[0]?.website,
			).toBe('https://acme.es')
			expect(result.blankedSharedHost).toBe(0)
		})
	})

	describe('when the run has read more than one answer', () => {
		it('should blank a member page another company claimed in an earlier answer', () => {
			// GIVEN the sequence a run really runs: a first answer holding one member
			// of a trade body, then a later round holding two, each answer checked on
			// its own and the two folded together afterwards
			const held = guardCompanyWebsites({
				findings: cited([
					{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				]),
				tradeWords: noTrades,
			})
			const round = guardCompanyWebsites({
				findings: cited([
					{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
					{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
				]),
				priorClaims: held.hostClaims,
				tradeWords: noTrades,
			})
			const folded = mergePerFieldSearch(
				held.findings,
				round.findings,
				'prospect_scan_v1',
				noTrades,
			)

			// WHEN the folded list is checked against everything the run has read
			const judged = guardCompanyWebsites({
				findings: folded.findings,
				priorClaims: round.hostClaims,
				tradeWords: noTrades,
			})

			// THEN nobody keeps the trade body's host. The first answer had one
			// claimant and kept the address; the round had two and blanked both, which
			// is what leaves one row standing on it in the folded list. Only the claims
			// the run carried put the two companies together again
			expect(prospectWebsites(judged.findings)).toEqual([undefined, undefined])
			expect(judged.blankedSharedHost).toBe(1)
		})

		it('should hand back what it read, so a later answer can be judged against it', () => {
			// GIVEN one answer holding a single company
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
			])

			// WHEN checked
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })

			// THEN the claim it read comes back with it, filed under the host, so the
			// next answer is weighed against a company that is not in it
			expect([...(result.hostClaims.get('aemiat.com')?.keys() ?? [])]).toEqual([
				'electricidadmora',
			])
		})

		it('should record a claim before the rule blanks it', () => {
			// GIVEN one answer holding both members, which the rule condemns outright
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
			])

			// WHEN checked
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })

			// THEN both addresses go — AND both claims survive in what is handed back.
			// Reading the answer it produced would find one claimant or none, so the
			// evidence has to be taken before the blanking or a later answer inherits
			// nothing
			expect(websitesOf(result.findings)).toEqual([undefined, undefined])
			expect([...(result.hostClaims.get('aemiat.com')?.keys() ?? [])]).toEqual([
				'electricidadmora',
				'instalacionesrubio',
			])
		})

		it('should keep a site whose host an earlier answer named its claimant by', () => {
			// GIVEN one company met under its trade name first, on the site that name
			// is in, and under its legal name in a later answer
			const first = guardCompanyWebsites({
				findings: scan([{ name: 'SICE', website: 'https://www.sice.com' }]),
				tradeWords: noTrades,
			})

			// WHEN the later answer is checked against what the first one read
			const later = guardCompanyWebsites({
				findings: scan([
					{
						name: 'Sociedad Ibérica de Construcciones Eléctricas',
						website: 'https://sice.com/es',
					},
				]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN the address stands. Carrying the claims makes the two rows two
			// claimants on one host for the first time — and the host plainly belongs
			// to one of them, which is the whole reason this rule stands down. Blanking
			// here would take away the only thing saying the two rows are one company
			expect(websitesOf(later.findings)).toEqual(['https://sice.com/es'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should keep a site whose host only a later answer names its claimant by', () => {
			// GIVEN the same company, met the other way round: the legal name that
			// spells nothing arrives first, the trade name the domain carries second
			const first = guardCompanyWebsites({
				findings: scan([
					{
						name: 'Sociedad Ibérica de Construcciones Eléctricas',
						website: 'https://sice.com/es',
					},
				]),
				tradeWords: noTrades,
			})

			// WHEN the answer holding the trade name is checked against it
			const later = guardCompanyWebsites({
				findings: scan([{ name: 'SICE', website: 'https://www.sice.com' }]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN it stands too: which answer named the host is not what settles it,
			// so the rule cannot come out differently for the order the rounds ran in
			expect(websitesOf(later.findings)).toEqual(['https://www.sice.com'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should keep a domain spelling a claimant name front across answers', () => {
			// GIVEN one company met under one name first and under another in a later
			// answer, both on the domain that is the front of the first name
			const first = guardCompanyWebsites({
				findings: scan([{ name: 'XPO Logistics', website: 'https://xpo.com' }]),
				tradeWords: noTrades,
			})

			// WHEN the later answer is checked against what the first read
			const later = guardCompanyWebsites({
				findings: scan([{ name: 'XPO Iberia', website: 'https://xpo.com/es' }]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN it stands. Carrying the claims is what puts two names on this host
			// for the first time, so the reading that recognises an abbreviated domain
			// as its owner's has to hold across answers too, or the fix for a trade
			// body's page is paid for with real company sites
			expect(websitesOf(later.findings)).toEqual(['https://xpo.com/es'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should keep a site one company claims two ways across answers', () => {
			// GIVEN a firm met under its short name first and with a word in front of
			// it in a later answer, on the same site both times
			const first = guardCompanyWebsites({
				findings: scan([
					{ name: 'SIMIE', website: 'https://www.securiteincendie.fr/' },
				]),
				tradeWords: noTrades,
			})

			// WHEN the later answer is checked against what the first read
			const later = guardCompanyWebsites({
				findings: scan([
					{ name: 'Groupe SIMIE', website: 'https://www.securiteincendie.fr/' },
				]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN it stands. Carrying the claims is what brings the two writings
			// together for the first time, so counting companies rather than writings
			// has to hold across answers too
			expect(websitesOf(later.findings)).toEqual([
				'https://www.securiteincendie.fr/',
			])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should not make a crowd of one company met under two spellings', () => {
			// GIVEN one company on a host that does not name it, written with the
			// Catalan geminate mark in the first answer and without it in the second
			const first = guardCompanyWebsites({
				findings: scan([
					{ name: 'Instal·lacions Puig', website: 'https://gremi.cat/puig/' },
				]),
				tradeWords: noTrades,
			})

			// WHEN the second answer is checked against what the first read
			const later = guardCompanyWebsites({
				findings: scan([
					{ name: 'Instal.lacions Puig', website: 'https://gremi.cat/puig/' },
				]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN the address stands. A company is held under the one name it is
			// written by however an answer spells it, so re-reading the same company
			// every round can never make it two companies claiming one host
			expect(websitesOf(later.findings)).toEqual(['https://gremi.cat/puig/'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should not count a name with nothing distinctive as a claimant', () => {
			// GIVEN a row whose name is nothing but a legal form, on a host a real
			// company claims in a later answer
			const first = guardCompanyWebsites({
				findings: scan([{ name: 'SL', website: 'https://gremi.cat/anon/' }]),
				tradeWords: noTrades,
			})

			// WHEN the later answer is checked against it
			const later = guardCompanyWebsites({
				findings: scan([
					{ name: 'Electricidad Mora', website: 'https://gremi.cat/mora/' },
				]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN the address stands: a name nothing can be read from says nothing
			// about who a host belongs to, so it must not be carried as a claimant and
			// turn one company into two
			expect(websitesOf(later.findings)).toEqual(['https://gremi.cat/mora/'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should leave a host alone when only one company ever claimed it', () => {
			// GIVEN the same single company read again in a later answer
			const first = guardCompanyWebsites({
				findings: scan([
					{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				]),
				tradeWords: noTrades,
			})

			// WHEN the later answer is checked against what the first read
			const later = guardCompanyWebsites({
				findings: scan([
					{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN it stands. Carrying the claims counts companies, never readings, so
			// a run that reads the same company every round does not talk itself into
			// blanking its address
			expect(websitesOf(later.findings)).toEqual(['https://aemiat.com/e-mora/'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should not carry a person website in a proposal into what it read', () => {
			// GIVEN a contact proposal naming a host, read before an answer that puts a
			// second company on it
			const first = guardCompanyWebsites({
				findings: {
					prospects: [
						{ name: 'Acme Instal', website: 'https://gremi.cat/acme/' },
					],
					proposed_updates: [
						{
							operation: 'create',
							fields: {
								name: 'Ada Lovelace',
								website: 'https://gremi.cat/ada/',
							},
						},
					],
				},
				tradeWords: noTrades,
			})

			// WHEN the later answer is checked against it
			const later = guardCompanyWebsites({
				findings: scan([
					{ name: 'Acme Instal', website: 'https://gremi.cat/acme/' },
				]),
				priorClaims: first.hostClaims,
				tradeWords: noTrades,
			})

			// THEN the company keeps its address: the proposal subtree is skipped when
			// the claims are gathered, so a person cannot follow the run into a later
			// round and cost a company its site there
			expect(websitesOf(later.findings)).toEqual(['https://gremi.cat/acme/'])
			expect(later.blankedSharedHost).toBe(0)
		})

		it('should judge an answer the same way when nothing was read before it', () => {
			// GIVEN one answer with a shared host, a listing shape and an own site in it
			const findings = scan([
				{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
				{ name: 'Acme', website: 'https://directorio.es/empresa/acme' },
				{
					name: 'XPO Logistics',
					website: 'https://xpo.com/about-xpo-logistics',
				},
			])

			// WHEN checked with no earlier claims, either left out or handed in empty
			const withoutPrior = guardCompanyWebsites({
				findings,
				tradeWords: noTrades,
			})
			const withEmptyPrior = guardCompanyWebsites({
				findings,
				priorClaims: new Map(),
				tradeWords: noTrades,
			})

			// THEN both read the answer identically: with nothing carried in, an
			// answer is judged on itself alone
			expect(websitesOf(withEmptyPrior.findings)).toEqual(
				websitesOf(withoutPrior.findings),
			)
			expect(withEmptyPrior.blankedSharedHost).toBe(
				withoutPrior.blankedSharedHost,
			)
			expect(withEmptyPrior.blankedProfilePage).toBe(
				withoutPrior.blankedProfilePage,
			)
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })

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
			expect(
				guardCompanyWebsites({ findings, tradeWords: noTrades }).findings,
			).toEqual({
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedProfilePage).toBe(1)
			expect(result.blankedReadPage).toBe(0)
		})
	})

	describe('when a website survives every rule', () => {
		it("should say whether anything establishes it as the company's own site", () => {
			// GIVEN two companies that both keep their address: one at the domain its
			// name spells, one at a host that spells nothing
			const findings = scan([
				{ name: 'Redwood Logistics', website: 'https://redwoodlogistics.com' },
				{ name: 'KBE Energy', website: 'https://annuaire.tecsol.fr' },
			])

			// WHEN checked
			// THEN both are kept and the two are told apart anyway, which is the whole
			// point: surviving the rules is not the same statement as owning the site
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([
				'https://redwoodlogistics.com',
				'https://annuaire.tecsol.fr',
			])
			expect(result.ownSiteEstablished).toBe(1)
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should count nothing for a website it blanked', () => {
			// GIVEN an address the deeper-path rule takes away
			const findings = scan([
				{
					name: 'Redwood Logistics',
					website: 'https://cbinsights.com/company/redwood-logistics',
				},
			])

			// WHEN checked — THEN an address that is gone has no ownership left to
			// establish, so it lands in neither column rather than swelling the
			// unvouched-for one
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.blankedProfilePage).toBe(1)
			expect(result.ownSiteEstablished + result.ownSiteUnknown).toBe(0)
		})
	})

	describe('when a kept address gives the rules nothing to work with', () => {
		it('should read a bare host on an unrelated domain as unestablished', () => {
			// GIVEN a listing's home page, cited as the page read. With no path there
			// is no page to tell apart from the site, so the read-page rule stands
			// down by design
			const findings = cited([
				{
					name: 'KBE Energy',
					website: 'https://annuaire.tecsol.fr',
					sources: ['https://annuaire.tecsol.fr'],
				},
			])

			// WHEN checked — THEN it is kept, and unvouched for
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([
				'https://annuaire.tecsol.fr',
			])
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should read a row citing nothing as unestablished', () => {
			// GIVEN a row whose citations a guard ahead of this one already dropped,
			// which leaves the read-page rule with no provenance to weigh
			const findings = cited([
				{ name: 'KBE Energy', website: TECSOL_LISTING, sources: [] },
			])

			// WHEN checked — THEN silence about where a claim came from is not a
			// reason to call the address the company's
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should read a row with a second source elsewhere as unestablished', () => {
			// GIVEN a listing address on a row something else also mentioned, which
			// stands the read-page rule down
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: [TECSOL_LISTING, 'https://www.lemoniteur.fr/kbe-energy'],
				},
			])

			// WHEN checked — THEN a second source about the COMPANY says nothing about
			// who owns the ADDRESS, so it buys the address no standing
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should read a slug carrying a word of the name as unestablished', () => {
			// GIVEN a listing whose trade slug happens to spell a word of the name,
			// which reads to the read-page rule as the address naming the company
			const listing = 'https://annuaire.fr/energy-installateurs-12345'
			const findings = cited([
				{ name: 'KBE Energy', website: listing, sources: [listing] },
			])

			// WHEN checked — THEN the coincidence buys nothing here, because a path
			// names a page about the company rather than the company's site
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([listing])
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should read a row citing an opaque source id as unestablished', () => {
			// GIVEN a row citing its page by the id the run stored it under, which
			// carries no host for the read-page rule to compare
			const findings = cited([
				{
					name: 'KBE Energy',
					website: TECSOL_LISTING,
					sources: ['src_9f2a1b3c4d5e6f70'],
				},
			])

			// WHEN checked — THEN a citation nothing can be read off is not a
			// clearance
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([TECSOL_LISTING])
			expect(result.ownSiteUnknown).toBe(1)
		})
	})

	describe("when ownership is asked of the run's own answer for the target", () => {
		it('should hold that field to the same bar as a scanned row', () => {
			// GIVEN one address on a host that spells no part of the name, put twice:
			// as the run's own answer for the target, whose single source is a page
			// elsewhere, and as an ordinary scanned row
			const website = 'https://kbe-groupe.example/nos-activites'
			const target = guardCompanyWebsites({
				findings: {
					enrichment: {
						website: {
							value: website,
							source_id: 'https://www.lemoniteur.fr/kbe-energy',
							confidence: null,
						},
					},
				},
				targetName: 'KBE Energy',
				tradeWords: noTrades,
			})
			const row = guardCompanyWebsites({
				findings: cited([
					{
						name: 'KBE Energy',
						website,
						sources: [website, 'https://www.lemoniteur.fr/kbe-energy'],
					},
				]),
				tradeWords: noTrades,
			})

			// WHEN both are checked
			// THEN both keep the address and both read it as unestablished. That field
			// carries exactly one source and can never carry a second, so a rule that
			// stands down once a row has two is weaker there than anywhere else — and
			// this question reads no sources at all, so the bar is the same
			expect(target.ownSiteEstablished).toBe(0)
			expect(target.ownSiteUnknown).toBe(1)
			expect(row.ownSiteEstablished).toBe(0)
			expect(row.ownSiteUnknown).toBe(1)
		})

		it("should establish the target's own site against the name it was told", () => {
			// GIVEN the company's real domain as the run's answer for the target
			const findings = {
				enrichment: {
					website: {
						value: 'https://redwoodlogistics.com/about',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked against the company the run is about
			// THEN the name told from outside is what the domain is read against, so
			// the field that arrives with no name beside it can still be established
			const result = guardCompanyWebsites({
				findings,
				targetName: 'Redwood Logistics',
				tradeWords: noTrades,
			})
			expect(result.ownSiteEstablished).toBe(1)
			expect(result.ownSiteUnknown).toBe(0)
		})

		it('should establish nothing for that field when no name was told', () => {
			// GIVEN the same real domain on a run that was given no target name
			const findings = {
				enrichment: {
					website: {
						value: 'https://redwoodlogistics.com/about',
						source_id: 'src_a',
						confidence: null,
					},
				},
			}

			// WHEN checked with nothing to compare — THEN unknown, because there is no
			// company for the domain to be the company's own site OF
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.ownSiteEstablished).toBe(0)
			expect(result.ownSiteUnknown).toBe(1)
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
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.findings).toEqual(findings)
			expect(result.blankedDirectory + result.blankedProfilePage).toBe(0)
		})
	})

	describe('when the company name is written with a geminated l', () => {
		it('should keep the site whichever way the host spells it', () => {
			// GIVEN a Catalan company whose only source is the page on its own site,
			// so the address naming the company is the only thing holding the value,
			// and whose domain writes the geminate with a single l as a slug does
			const findings = cited([
				{
					name: 'Il·lusions SL',
					website: 'https://ilusions.cat/contacte',
					sources: ['https://ilusions.cat/contacte'],
				},
			])

			// WHEN checked
			// THEN the site stays and is established as the company's own. Read only
			// the way the name is written, the host spelled nothing the run knew and
			// the company lost the very page it published
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([
				'https://ilusions.cat/contacte',
			])
			expect(result.blankedReadPage).toBe(0)
			expect(result.ownSiteEstablished).toBe(1)
		})

		it('should keep the site when the host doubles the l instead', () => {
			// GIVEN the same company at the domain that keeps both l's
			const findings = cited([
				{
					name: 'Il·lusions SL',
					website: 'https://illusions.cat/contacte',
					sources: ['https://illusions.cat/contacte'],
				},
			])

			// WHEN checked — THEN it is kept too, so reading the name both ways costs
			// the spelling that already worked nothing
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([
				'https://illusions.cat/contacte',
			])
			expect(result.blankedReadPage).toBe(0)
		})

		it('should still blank a listing page that files it under either spelling', () => {
			// GIVEN the same company on somebody else's host, filed one level down
			// under each spelling in turn
			// WHEN checked
			// THEN both are blanked as the profile pages they are. Reading a name
			// more ways sharpens this rule as much as it softens the one above —
			// the loosening is not one-directional
			for (const website of [
				'https://directori.cat/empresa/ilusions',
				'https://directori.cat/empresa/illusions',
			]) {
				const result = guardCompanyWebsites({
					findings: cited([
						{ name: 'Il·lusions SL', website, sources: [website] },
					]),
					tradeWords: noTrades,
				})
				expect(prospectWebsites(result.findings)).toEqual([undefined])
				expect(result.blankedProfilePage).toBe(1)
			}
		})

		it('should keep every spelling a repeated company was written with', () => {
			// GIVEN one Catalan company listed twice on its own host — once with the
			// mark and once without, which is how one list writes one firm twice —
			// beside two other companies that also gave that host
			const findings = cited([
				{ name: 'Il·lusions SL', website: 'https://ilusions.cat' },
				{ name: 'Illusions SL', website: 'https://ilusions.cat' },
				{ name: 'Fusteria Miquel SL', website: 'https://ilusions.cat' },
				{ name: 'Serralleria Roca SL', website: 'https://ilusions.cat' },
			])

			// WHEN checked
			// THEN nothing is blanked: the host is plainly the Catalan company's, and
			// the reading that says so came from the row with the mark. Keeping only
			// the later row's spellings would lose it and blank all four
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.blankedSharedHost).toBe(0)
			expect(prospectWebsites(result.findings)).toEqual([
				'https://ilusions.cat',
				'https://ilusions.cat',
				'https://ilusions.cat',
				'https://ilusions.cat',
			])
		})

		it('should count one company claiming a host as one claimant, not two', () => {
			// GIVEN one Catalan company and one other company on the same host, which
			// the Catalan company's name is carried by
			const findings = cited([
				{ name: 'Il·lusions SL', website: 'https://ilusions.cat' },
				{ name: 'Fusteria Miquel SL', website: 'https://ilusions.cat' },
			])

			// WHEN checked
			// THEN the host is plainly the Catalan company's and nothing is blanked
			// as a shared host. Its two spellings must count as the one company they
			// are — counted apart, a single company would look like a crowd and the
			// rule would fire on a host it owns
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.blankedSharedHost).toBe(0)
			expect(prospectWebsites(result.findings)).toEqual([
				'https://ilusions.cat',
				'https://ilusions.cat',
			])
		})
	})

	describe('when the run own target is written with a geminated l', () => {
		it('should keep the target site whichever way its host spells the name', () => {
			// GIVEN the run's own answer for its target's website — a value with the
			// page it came from and no company name beside it, so the name is told
			// from outside — at each spelling of the company's domain in turn
			// WHEN checked against the company the run is about
			// THEN the host carries the name either way and the site stands. This
			// field is the strict path: it can never have a second source to stand
			// the read-page rule down, so a host the run cannot read the name in is
			// the whole of what holds the value
			for (const value of [
				'https://instalacionsvives.cat/contacte',
				'https://installacionsvives.cat/contacte',
			]) {
				const findings = {
					enrichment: {
						website: { value, source_id: value, confidence: null },
					},
				}
				const result = guardCompanyWebsites({
					findings,
					targetName: 'Instal·lacions Vives SL',
					tradeWords: noTrades,
				})
				expect(
					(result.findings as { enrichment: Record<string, unknown> })
						.enrichment['website'],
				).toEqual({ value, source_id: value, confidence: null })
				expect(result.blankedReadPage + result.blankedProfilePage).toBe(0)
			}
		})

		it('should still blank a listing filing the target under either spelling', () => {
			// GIVEN a directory filing the target one level down, spelled each way
			// WHEN checked against the company the run is about
			// THEN both are caught as the profile pages they are
			for (const value of [
				'https://empreses.example.org/empresa/instalacions-vives',
				'https://empreses.example.org/empresa/installacions-vives',
			]) {
				const findings = {
					enrichment: {
						website: { value, source_id: 'src_a', confidence: null },
					},
				}
				const result = guardCompanyWebsites({
					findings,
					targetName: 'Instal·lacions Vives SL',
					tradeWords: noTrades,
				})
				expect(
					(result.findings as { enrichment: Record<string, unknown> })
						.enrichment['website'],
				).toBeNull()
				expect(result.blankedProfilePage).toBe(1)
			}
		})
	})

	describe('when the company name holds no word of its own', () => {
		it('should count the row as judged on the whole name alone', () => {
			// GIVEN a company named only after a kind of company and a trade, beside
			// one whose name carries a word of its own
			const findings = cited([
				{ name: 'Grupo Express SL', website: 'https://grupoexpress.cat' },
				{ name: 'Fusteria Miquel SL', website: 'https://fusteriamiquel.cat' },
			])

			// WHEN checked
			// THEN one row is recorded as named after nobody in particular, and its
			// own exact domain still reads as unestablished — there is no word of the
			// company's for a domain to spell, so `unknown` here means the rules could
			// never have said anything else, not that nothing vouched for it
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.namedNobodyInParticular).toBe(1)
			expect(result.ownSiteEstablished).toBe(1)
			expect(result.ownSiteUnknown).toBe(1)
		})

		it('should not count a row whose name reads as nothing at all', () => {
			// GIVEN a row whose name is only a legal form, so there is no name to
			// judge the address against in the first place
			const findings = cited([
				{ name: 'SL', website: 'https://directori.cat/empresa/algu' },
			])

			// WHEN checked
			// THEN the website is kept, and the count stays at zero: a name that
			// reads as nothing is a different miss from a name that reads as a trade,
			// and adding the two together would hide both
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.namedNobodyInParticular).toBe(0)
			expect(prospectWebsites(result.findings)).toEqual([
				'https://directori.cat/empresa/algu',
			])
		})
	})

	describe('when the website is a page on a social platform', () => {
		it('should blank the company own page on the platform', () => {
			// GIVEN the row two live French market searches both returned: a small
			// firm with no site of its own, given the only web presence anybody could
			// find for it
			const findings = cited([
				{
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
					sources: ['https://www.facebook.com/LIPOTECH.SARL'],
				},
			])

			// WHEN checked
			// THEN the address goes. The page really is the company's, and it is
			// still not the company's website — whoever opens it lands on Facebook
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should blank a competitor page as readily as a prospect one', () => {
			// GIVEN the platform page on the other shape a scan answers with
			const findings = scan([
				{
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
				},
			])

			// WHEN checked — THEN blanked too. Which list a company arrived in says
			// nothing about whose site the address is
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(websitesOf(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should blank a host written with the dot a domain may end in', () => {
			// GIVEN the same page at the fully-spelled form of the host, which opens
			// in a browser exactly as the ordinary one does
			const findings = cited([
				{
					name: 'LIPOTECH SARL',
					website: 'https://facebook.com./LIPOTECH.SARL',
				},
			])

			// WHEN checked
			// THEN blanked. An address a reader can open is an address that ships, so
			// a spelling this check did not recognise would put the page back
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should blank a post inside a group on the platform', () => {
			// GIVEN the other address the same searches returned — a post inside a
			// group, which is not the company's page and not any company's site
			const findings = cited([
				{
					name: 'LIPOTECH SARL',
					website:
						'https://www.facebook.com/groups/electricienfrance/posts/1408466207156608',
					sources: ['https://annuaire.fr/lipotech', 'https://societe.com/x'],
				},
			])

			// WHEN checked
			// THEN blanked, whatever else the row cited. A row that cites a second
			// page stands down the rule that reads citations, and the platform is the
			// one reading that does not need them
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should blank a row that cites nothing at all', () => {
			// GIVEN the platform page with no citations behind it
			// WHEN checked
			// THEN still blanked. What the host IS holds whether or not the row says
			// where anything was read
			const findings = cited([
				{
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
				},
			])

			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should blank the platform home page given as a website', () => {
			// GIVEN a row handed the platform itself, with no page under it
			// WHEN checked
			// THEN blanked. Elsewhere a bare host is left alone because there is no
			// page to tell from the site; here the host is the whole answer
			const findings = cited([
				{ name: 'LIPOTECH SARL', website: 'https://facebook.com' },
			])

			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should blank a company page on any of the platforms', () => {
			// GIVEN the same company filed on each platform in turn
			// WHEN checked
			// THEN every one of them goes. A LinkedIn page is as much the company's
			// and as little its website as a Facebook one
			const findings = cited([
				{
					name: 'Acme Logistics',
					website: 'https://www.linkedin.com/company/acme-logistics',
				},
				{ name: 'Acme Logistics', website: 'https://x.com/acmelogistics' },
				{
					name: 'Acme Logistics',
					website: 'https://www.instagram.com/acmelogistics/',
				},
				{
					name: 'Acme Logistics',
					website: 'https://www.youtube.com/@acmelogistics',
				},
			])

			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([
				undefined,
				undefined,
				undefined,
				undefined,
			])
			expect(result.blankedSocialPage).toBe(4)
		})

		it('should blank the platform even when the company name spells its host', () => {
			// GIVEN an agency named after the platform it works on, which is an
			// ordinary kind of company
			// WHEN checked
			// THEN the page still goes. The host carrying a company's name is normally
			// the strongest reason to keep an address, and it is read AFTER this one
			// so a name cannot talk a platform into being somebody's site
			const findings = cited([
				{
					name: 'Insta Logistics',
					website: 'https://instagram.com/instalogistics',
				},
				{
					name: 'Facebook Ads Agency',
					website: 'https://www.facebook.com/fbadsagency',
				},
			])

			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined, undefined])
			expect(result.blankedSocialPage).toBe(2)
		})

		it('should blank a row with no readable name beside it', () => {
			// GIVEN a row named only by a legal form, which leaves every rule that
			// weighs a name with nothing to weigh
			// WHEN checked
			// THEN blanked anyway, because this rule never asked for a name
			const findings = cited([
				{ name: 'SL', website: 'https://www.facebook.com/quelquun' },
			])

			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([undefined])
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should empty the run own answer for the target company', () => {
			// GIVEN the run's own answer for the company it was asked about, which
			// arrives alone with the page it was read from and no name beside it
			const findings = {
				website: {
					value: 'https://www.facebook.com/LIPOTECH.SARL',
					source_id: 'src_1',
				},
			}

			// WHEN checked against the target's name
			// THEN emptied, so a reader of the profile sees the field was asked for
			// and not answered rather than seeing Facebook
			const result = guardCompanyWebsites({
				findings,
				targetName: 'LIPOTECH SARL',
				tradeWords: noTrades,
			})
			expect(result.findings).toEqual({ website: null })
			expect(result.blankedSocialPage).toBe(1)
		})

		it('should put only the surviving address to the ownership question', () => {
			// GIVEN a platform page beside a company at its own domain
			// WHEN checked
			// THEN an address that is gone has no ownership left to establish, so it
			// lands in neither column — counting it as unvouched-for would read as a
			// company whose site nothing backed
			const findings = cited([
				{
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
				},
				{ name: 'Fusteria Miquel SL', website: 'https://fusteriamiquel.cat' },
			])

			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.ownSiteEstablished).toBe(1)
			expect(result.ownSiteUnknown).toBe(0)
		})

		it('should count the blank under its own reason', () => {
			// GIVEN one row per reason: a platform page, a listing page filing the
			// company one level down, and a value that is not an address at all
			const findings = cited([
				{
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
				},
				{
					name: 'Redwood Logistics',
					website: 'https://cbinsights.com/company/redwood-logistics',
				},
				{
					name: 'Acme Freight',
					website: 'https://acme.es (inferred from the name)',
				},
			])

			// WHEN checked
			// THEN each is counted under its own reason, so a reader of the run's
			// numbers can tell how often a platform page was offered from how often a
			// directory was
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(result.blankedSocialPage).toBe(1)
			expect(result.blankedProfilePage).toBe(1)
			expect(result.blankedNotAnAddress).toBe(1)
			expect(result.blankedDirectory).toBe(0)
			expect(result.blankedSharedHost).toBe(0)
			expect(result.blankedReadPage).toBe(0)
		})
	})

	describe('when a host only resembles a social platform', () => {
		it('should keep a company own site whose domain starts with a platform name', () => {
			// GIVEN the agencies named after the platforms they work on, this time at
			// domains they registered themselves
			const findings = cited([
				{
					name: 'Facebook Ads Agency',
					website: 'https://facebook-ads-agency.com',
				},
				{
					name: 'Instagram Marketing',
					website: 'https://instagram-marketing.es',
				},
			])

			// WHEN checked
			// THEN both are kept. A platform's name inside somebody else's domain is
			// not the platform, and blanking these would cost two real companies the
			// site they publish
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([
				'https://facebook-ads-agency.com',
				'https://instagram-marketing.es',
			])
			expect(result.blankedSocialPage).toBe(0)
		})

		it('should keep a first-segment page on the company own domain', () => {
			// GIVEN a company describing itself on its own site at the first path
			// level — the same shape as a platform page and the reason no reading of
			// an address alone can separate the two
			const findings = cited([
				{
					name: 'XPO Logistics',
					website: 'https://xpo.com/about-xpo-logistics',
				},
			])

			// WHEN checked
			// THEN kept. What saves it is the host: a company's own domain is no
			// platform
			const result = guardCompanyWebsites({ findings, tradeWords: noTrades })
			expect(prospectWebsites(result.findings)).toEqual([
				'https://xpo.com/about-xpo-logistics',
			])
			expect(result.blankedSocialPage).toBe(0)
		})
	})
})
