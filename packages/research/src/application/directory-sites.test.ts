import { describe, expect, it } from 'vitest'

import {
	linkedAddresses,
	observeDirectorySites,
	siteVerdict,
} from './directory-sites'

// A prospect scan's list, as the guard chain hands it over.
const scan = (names: ReadonlyArray<string>) => ({
	prospects: names.map(name => ({ name })),
})

const observe = (
	names: ReadonlyArray<string>,
	addresses: ReadonlyArray<string>,
) =>
	observeDirectorySites({
		findings: scan(names),
		listField: 'prospects',
		addresses,
	})

describe('observeDirectorySites', () => {
	describe("when one host files several of the run's own companies", () => {
		it('should judge it a directory', () => {
			// GIVEN two of the run's companies each filed at their own address on one
			// host, and neither named by the host itself
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://aemiat.com/empresa/electricistas-puig',
					'https://aemiat.com/empresa/instalaciones-ferre',
				],
			)

			// WHEN the run's addresses are read
			// THEN the host is a listing, and it says how much it had to go on
			expect([...observation.sites]).toEqual(['aemiat.com'])
			expect(observation.addressesRead).toBe(2)
		})

		it('should judge it a directory when the name sits in the first segment', () => {
			// GIVEN a member directory that files each company at the top level,
			// which for a single address is indistinguishable from a company's own
			// site describing itself ("xpo.com/about-xpo")
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://aemiat.com/electricistas-puig/',
					'https://aemiat.com/instalaciones-ferre/',
				],
			)

			// WHEN read — THEN what separates the two is the second company, not the
			// shape of either address
			expect([...observation.sites]).toEqual(['aemiat.com'])
		})

		it('should want the whole name, not a shortened trading name', () => {
			// GIVEN a directory filing each company under the one word it is known by
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				['https://aemiat.com/puig', 'https://aemiat.com/ferre'],
			)

			// WHEN read — THEN neither address is read as filing the company: asking
			// for the whole name misses this listing, and the alternative is a name
			// fragment matching a site that has nothing to do with the company
			expect([...observation.sites]).toEqual([])
		})

		it('should read a name the address spells with its accents', () => {
			// GIVEN a listing that writes the accent into the address, which arrives
			// escaped — the ordinary way a Spanish or Catalan site files a name
			const observation = observe(
				['Instalaciones Ferré SA', 'Muñoz y Asociados SL'],
				[
					'https://listado.example/empresa/instalaciones-ferré',
					'https://listado.example/empresa/muñoz-y-asociados',
				],
			)

			// WHEN read — THEN the escapes are put back into letters first, so the
			// names are found where they really are
			expect([...observation.sites]).toEqual(['listado.example'])
		})

		it('should read accents and punctuation as the address writes them', () => {
			// GIVEN a directory spelling one name without its accent and the other
			// with its legal form glued on
			const observation = observe(
				['Instalaciones Ferré SA', 'Muñoz y Asociados SL'],
				[
					'https://directorio.es/empresa/INSTALACIONES-FERRE-SA.html',
					'https://directorio.es/empresa/munoz_y_asociados.html',
				],
			)

			// WHEN read — THEN spelling does not hide either filing
			expect([...observation.sites]).toEqual(['directorio.es'])
		})
	})

	describe("when a host is seen for only one of the run's companies", () => {
		it('should leave it unknown — a trade paper naming one company', () => {
			// GIVEN a regional paper running a piece that names one of the companies,
			// and a second piece on the same paper naming none of them
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://diaridegirona.cat/economia/electricistas-puig-obre-seu',
					'https://diaridegirona.cat/economia/el-sector-creix-un-4',
				],
			)

			// WHEN read — THEN it is unknown, never cleared: one company is not
			// evidence of a listing, and nothing here can prove the paper is not one
			expect([...observation.sites]).toEqual([])
			expect(siteVerdict('diaridegirona.cat', observation.sites)).toBe(
				'unknown',
			)
		})

		it('should judge a paper that ran a piece on two of them a listing', () => {
			// GIVEN one paper carrying two sector pieces, each naming a different
			// company of the run in its own address
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://diaridegirona.cat/economia/electricistas-puig-obre-seu',
					'https://diaridegirona.cat/economia/instalaciones-ferre-creix',
				],
			)

			// WHEN read — THEN the paper is judged a listing, which it is not. A host
			// is weighed on every address met on it, and two pieces cannot be told
			// from two filings by the addresses alone. What it costs is the paper's
			// standing as a source that is not a directory, so a company it is the
			// only corroboration for goes unconfirmed — the answer is withheld, never
			// invented
			expect([...observation.sites]).toEqual(['diaridegirona.cat'])
		})

		it('should not let one page naming two of them make a listing', () => {
			// GIVEN a single piece about a deal between two of the run's companies,
			// naming both in its own address
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://elmundo.es/economia/electricistas-puig-compra-instalaciones-ferre',
				],
			)

			// WHEN read — THEN it takes a separate address per company: a site that
			// files them files each of them somewhere, and one page mentioning both is
			// what a piece about a deal looks like
			expect([...observation.sites]).toEqual([])
		})

		it('should not count a company named again at more length as two', () => {
			// GIVEN a firm's own site naming itself both ways it is written
			const observation = observe(
				['Grupo Ferré SL', 'Grupo Ferré Instalacions SL'],
				[
					'https://gfi.example/grupo-ferre',
					'https://gfi.example/nosotros/grupo-ferre-instalacions',
				],
			)

			// WHEN read — THEN a name another name starts with is that same company
			// written at more length, so this is one company on its own site
			expect([...observation.sites]).toEqual([])
		})

		it('should not read a short name out of the middle of a word', () => {
			// GIVEN two short names that sit inside ordinary Catalan and Spanish
			// words — "roca" inside "barroca", "mont" inside "montcada"
			const observation = observe(
				['Roca SL', 'Mont SA'],
				[
					'https://lavanguardia.com/economia/barroca-inversiones',
					'https://lavanguardia.com/local/montcada-i-reixac/obres',
				],
			)

			// WHEN read — THEN a name has to be spelled by whole words of the address,
			// so neither page files anybody and a newspaper survives
			expect([...observation.sites]).toEqual([])
		})

		it('should leave both unknown when two companies sit on two hosts', () => {
			// GIVEN each company filed on a different host
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://uno.example/electricistas-puig',
					'https://dos.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN one company each proves nothing about either host
			expect([...observation.sites]).toEqual([])
		})

		it('should not count one company met at two addresses as two', () => {
			// GIVEN the same company filed twice on one host — a profile page and the
			// section it sits in
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://listado.example/empresa/electricistas-puig',
					'https://listado.example/girona/electricistas-puig-sl',
				],
			)

			// WHEN read — THEN it is still one company, so the host stays unknown
			expect([...observation.sites]).toEqual([])
		})

		it('should not count one company spelled two ways as two', () => {
			// GIVEN a list holding the same company under a dotted and an undotted
			// legal form, which the fold that settles it only reaches later
			const observation = observe(
				['Muñoz S.L.', 'MUÑOZ SL'],
				[
					'https://listado.example/empresa/munoz-sl',
					'https://listado.example/g/munoz',
				],
			)

			// WHEN read — THEN both spellings are the one company they are, and a host
			// filing only it is not a listing
			expect([...observation.sites]).toEqual([])
		})
	})

	describe('when the host itself carries one of the company names', () => {
		it("should never call a company's own site a directory", () => {
			// GIVEN a company's own site naming two other companies of the run in its
			// addresses — a page per partner, a page per client
			const observation = observe(
				['Instalaciones Ferré SA', 'Electricistas Puig SL', 'Muñoz SL'],
				[
					'https://instalacionesferre.es/partners/electricistas-puig',
					'https://instalacionesferre.es/obras/munoz',
				],
			)

			// WHEN read — THEN the host being named by one of them settles it: one
			// host cannot be a stranger's listing and that company's own site at once
			expect([...observation.sites]).toEqual([])
		})

		it('should recognise the short domain a company usually has', () => {
			// GIVEN the same shape on a domain that is one word of the name rather
			// than all of it — "acme.example" for "Acme Instalacions SL", which is how
			// most firms register
			const observation = observe(
				['Acme Instalacions SL', 'Electricistas Puig SL', 'Muñoz SL'],
				[
					'https://acme.example/partners/electricistas-puig',
					'https://acme.example/obras/munoz',
				],
			)

			// WHEN read — THEN it is still that company's own site
			expect([...observation.sites]).toEqual([])
		})

		it('should not let a name merely appearing in the host stand the rule down', () => {
			// GIVEN a listing whose host happens to contain a company's name
			const observation = observe(
				['Acme SL', 'Electricistas Puig SL', 'Muñoz y Asociados SL'],
				[
					'https://acme-directorio.example/electricistas-puig',
					'https://acme-directorio.example/munoz-y-asociados',
				],
			)

			// WHEN read — THEN the domain has to BE a name, not carry one, so the
			// listing is still judged one
			expect([...observation.sites]).toEqual(['acme-directorio.example'])
		})
	})

	describe('when a name is too short to look for', () => {
		it('should ignore a name that is nothing but a legal form', () => {
			// GIVEN a row whose name leaves no core once the form is taken out, beside
			// a real one
			const observation = observe(
				['SL', 'Instalaciones Ferré SA'],
				[
					'https://listado.example/sl-empresa',
					'https://listado.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN one usable name cannot reach two, so nothing is judged
			expect([...observation.sites]).toEqual([])
		})

		it('should ignore a name shorter than four letters', () => {
			// GIVEN a three-letter name, which turns up inside an unrelated address by
			// coincidence
			const observation = observe(
				['Vex', 'Instalaciones Ferré SA', 'Electricistas Puig SL'],
				[
					'https://listado.example/servicios/vexilla-consulting',
					'https://listado.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN the short name vouches for nothing and one real filing
			// is left, which is not enough
			expect([...observation.sites]).toEqual([])
		})
	})

	describe('when the key would be a folded domain', () => {
		it('should keep a sub-brand verdict off its parent', () => {
			// GIVEN a business directory run as a subdomain of a real newspaper
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://empresite.eleconomista.es/ELECTRICISTAS-PUIG.html',
					'https://empresite.eleconomista.es/INSTALACIONES-FERRE.html',
					'https://eleconomista.es/empresas/electricistas-puig-creix',
				],
			)

			// WHEN read — THEN only the sub-brand is a listing; the newspaper it sits
			// under is untouched, because it is the newspapers that have to survive as
			// the source that is not a directory
			expect([...observation.sites]).toEqual(['empresite.eleconomista.es'])
			expect(siteVerdict('eleconomista.es', observation.sites)).toBe('unknown')
		})

		it('should keep a parent verdict off its sub-brand', () => {
			// GIVEN the parent host filing two companies and the subdomain filing one
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://listado.example/electricistas-puig',
					'https://listado.example/instalaciones-ferre',
					'https://blog.listado.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN the verdict stops at the host it was earned on
			expect([...observation.sites]).toEqual(['listado.example'])
			expect(siteVerdict('blog.listado.example', observation.sites)).toBe(
				'unknown',
			)
		})

		it('should read www as the same site', () => {
			// GIVEN one filing written with www and the other without
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://www.listado.example/electricistas-puig',
					'https://listado.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN www is not a different site
			expect([...observation.sites]).toEqual(['listado.example'])
		})
	})

	describe('when an address is not a web address', () => {
		it('should not count an internal source id as a website', () => {
			// GIVEN a run's own reference to a page it stored, which parses as the
			// "host" src_9f2a1b if it is never screened
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				['src_9f2a1b', 'src_4c8d2e'],
			)

			// WHEN read — THEN neither counts as a site the run met
			expect([...observation.sites]).toEqual([])
			expect(observation.addressesRead).toBe(0)
		})

		it('should skip a mailbox and an unreadable value', () => {
			// GIVEN an address that is a mailbox and one that was never an address
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'mailto:info@listado.example',
					'not an address at all',
					'https://listado.example/electricistas-puig',
					'https://listado.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN only the two real addresses are read, and they are
			// enough on their own
			expect([...observation.sites]).toEqual(['listado.example'])
			expect(observation.addressesRead).toBe(2)
		})
	})

	describe('when a name is only nearly in the address', () => {
		it('should not splice two segments into one name', () => {
			// GIVEN a company whose name is spread across a segment boundary, which
			// reading the path as one string would join up
			const observation = observe(
				['Rosa Blanca SL', 'Instalaciones Ferré SA'],
				[
					'https://listado.example/rosa/blanca-flores',
					'https://listado.example/instalaciones-ferre',
				],
			)

			// WHEN read — THEN the address does not file Rosa Blanca, so one filing is
			// left and the host stays unknown
			expect([...observation.sites]).toEqual([])
		})

		it('should not read a name that sits only in the query', () => {
			// GIVEN an older directory that files a company in a query parameter
			// rather than in the path
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[
					'https://listado.example/ficha.php?empresa=electricistas-puig',
					'https://listado.example/ficha.php?empresa=instalaciones-ferre',
				],
			)

			// WHEN read — THEN it is missed: only the path is read, because a query is
			// also where a search engine carries whatever was typed into it, and a
			// missed listing costs less than every search page becoming one
			expect([...observation.sites]).toEqual([])
		})
	})

	describe('when the run has no list of its own', () => {
		it('should observe nothing for a run about one named company', () => {
			// GIVEN an enrichment run, which has no list field to compare
			const observation = observeDirectorySites({
				findings: { enrichment: { name: 'Acme SL' } },
				listField: undefined,
				addresses: [
					'https://listado.example/electricistas-puig',
					'https://listado.example/instalaciones-ferre',
				],
			})

			// WHEN read — THEN one company can never reach two, so nothing is judged —
			// and it still says how many addresses it had, so a run that gathered
			// plenty is not reported the same as one that gathered none
			expect([...observation.sites]).toEqual([])
			expect(observation.addressesRead).toBe(2)
		})

		it('should observe nothing when the list holds one company', () => {
			// GIVEN a scan that returned a single company
			const observation = observe(
				['Electricistas Puig SL'],
				['https://listado.example/electricistas-puig'],
			)

			// WHEN read — THEN there is nobody to compare it against
			expect([...observation.sites]).toEqual([])
		})

		it('should observe nothing when the list is empty or nameless', () => {
			// GIVEN a list with no rows, and one whose rows carry no name
			const empty = observe([], ['https://listado.example/x'])
			const nameless = observeDirectorySites({
				findings: { prospects: [{ website: 'https://a.example' }, {}] },
				listField: 'prospects',
				addresses: ['https://listado.example/x'],
			})

			// WHEN read — THEN neither yields a name to look for
			expect([...empty.sites]).toEqual([])
			expect([...nameless.sites]).toEqual([])
		})

		it('should observe nothing when no address was gathered', () => {
			// GIVEN a resumed run, which skips the phase that gathers addresses
			const observation = observe(
				['Electricistas Puig SL', 'Instalaciones Ferré SA'],
				[],
			)

			// WHEN read — THEN every host stays unknown, which withholds rather than
			// invents
			expect([...observation.sites]).toEqual([])
			expect(observation.addressesRead).toBe(0)
		})
	})
})

describe('linkedAddresses', () => {
	describe('when a fetched page links to other addresses', () => {
		it('should read a listing index page own per-company links', () => {
			// GIVEN the text of a directory's category page, whose own address names a
			// trade and a province and no company, with its per-company pages linked
			// from it the way a fetched page writes them
			const page = [
				'# Instalaciones Electricas en Girona (Gerona)',
				'Hemos encontrado 85 empresas.',
				'- [Inergi instalaciones energeticas sl.](https://empresite.eleconomista.es/INERGI-INSTALACIONES-ENERGETICAS-GERONA.html)',
				'- [Imec installacions sl](https://empresite.eleconomista.es/IMEC-INSTAL-LACIONS.html)',
				'See also https://empresite.eleconomista.es/Actividad/CALEFACCION/.',
			].join('\n')

			// WHEN the page's links are read
			const found = linkedAddresses(page)

			// THEN both the bracketed links and the one written into the prose come
			// back, without the punctuation that ended them
			expect(found).toContain(
				'https://empresite.eleconomista.es/INERGI-INSTALACIONES-ENERGETICAS-GERONA.html',
			)
			expect(found).toContain(
				'https://empresite.eleconomista.es/IMEC-INSTAL-LACIONS.html',
			)
			expect(found).toContain(
				'https://empresite.eleconomista.es/Actividad/CALEFACCION/',
			)
		})

		it('should read one address once however often the page writes it', () => {
			// GIVEN a page linking the same address from its list and its footer
			const page =
				'[Acme](https://listado.example/acme) and again [Acme](https://listado.example/acme)'

			// WHEN read — THEN it is one address
			expect(linkedAddresses(page)).toEqual(['https://listado.example/acme'])
		})

		it('should leave an address the page writes relative to itself', () => {
			// GIVEN a page whose links are relative, which cannot be resolved without
			// deciding what they are relative to
			const page = '[Acme](/EMPRESA-ACME.html) [Ferré](../ferre.html)'

			// WHEN read — THEN nothing is invented
			expect(linkedAddresses(page)).toEqual([])
		})

		it('should read nothing out of a page with no links', () => {
			// GIVEN ordinary prose
			// WHEN read — THEN there is nothing to read
			expect(linkedAddresses('Som una empresa de Girona.')).toEqual([])
			expect(linkedAddresses('')).toEqual([])
		})
	})

	describe('when a page links more addresses than are worth reading', () => {
		it('should stop at the first few hundred', () => {
			// GIVEN a sitemap-shaped page listing a thousand addresses
			const page = Array.from(
				{ length: 1000 },
				(_, at) => `[${at}](https://listado.example/empresa-${at})`,
			).join('\n')

			// WHEN read — THEN it stops well before the end, since past a few hundred
			// they say nothing the earlier ones did not and each is weighed against
			// every company on the list
			expect(linkedAddresses(page)).toHaveLength(300)
		})
	})
})

describe('siteVerdict', () => {
	describe('when the host was watched filing several companies', () => {
		it('should say directory', () => {
			// GIVEN a host the run judged a listing
			// WHEN asked about it — THEN it says so
			expect(siteVerdict('aemiat.com', new Set(['aemiat.com']))).toBe(
				'directory',
			)
		})
	})

	describe('when the host was not', () => {
		it('should say unknown, which is not a clearance', () => {
			// GIVEN a host the run saw once, and one it never saw at all
			const sites = new Set(['aemiat.com'])

			// WHEN asked about either
			// THEN both are unknown — there is no third answer meaning "checked and
			// cleared", because nothing here can establish that a site is not a
			// listing, and a caller must not be able to read one out of silence
			expect(siteVerdict('diaridegirona.cat', sites)).toBe('unknown')
			expect(siteVerdict('never-seen.example', sites)).toBe('unknown')
			expect(siteVerdict('anything', new Set())).toBe('unknown')
		})
	})
})
