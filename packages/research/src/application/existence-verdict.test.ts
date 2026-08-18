import { describe, expect, it } from 'vitest'

import {
	existenceOf,
	isConfirmedRow,
	markRowsExistence,
	partitionByExistence,
	resultNamesCompany,
	rowExistence,
	withExistence,
} from './existence-verdict'

// A workshop whose own domain spells its name, so `ownSiteVerdict` establishes
// it — the only thing in the package that can clear a source.
const OWN = 'https://fusteriamiquel.cat'
const NAME = 'Fusteria Miquel'
// A regional paper: never watched filing anybody, so it reads `unknown`.
const PAPER = 'https://elpuntavui.cat/noticia/12345'
// A business directory's page about the company, on a host that spells no part
// of its name.
const LISTING = 'https://paginas.es/empresa/fusteria-miquel'
// A run that watched nothing behave like a listing.
const NONE: ReadonlySet<string> = new Set()

describe('existenceOf', () => {
	describe("when the company's own site and a second website name it", () => {
		it('should confirm the company', () => {
			// GIVEN a company at the domain its name spells
			// AND a second, unrelated website that also names it
			// WHEN asked whether it exists
			// THEN both conditions hold: two websites, one of them established
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: [PAPER],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'confirmed', websites: 2 })
		})

		it('should let a directory be the second website', () => {
			// GIVEN the company's own site, and a listing that files it
			// WHEN asked
			// THEN the listing counts toward the two — what it cannot do is CLEAR
			// the company, and nothing here asks it to
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: [LISTING],
					directorySites: new Set(['paginas.es']),
				}),
			).toEqual({ verdict: 'confirmed', websites: 2 })
		})

		it('should read a citation written as a bare host', () => {
			// GIVEN a second source cited without a scheme, the tidied spelling a
			// model reaches for
			// WHEN asked
			// THEN it is still an address, and still a second website
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: ['elpuntavui.cat'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'confirmed', websites: 2 })
		})

		it('should confirm from citations alone when the row has no website', () => {
			// GIVEN a row whose website field is empty, but which cites its own site
			// WHEN asked
			// THEN the website field is not privileged — a citation establishes
			// ownership exactly as the field would
			expect(
				existenceOf({
					name: NAME,
					sources: [OWN, PAPER],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'confirmed', websites: 2 })
		})
	})

	describe('when the site is one the run watched filing other companies', () => {
		it('should refuse to let a watched listing clear a company it is named for', () => {
			// GIVEN a listing whose own domain happens to spell the company's name,
			// which the domain reading alone takes for that company's own site
			// WHEN asked
			// THEN watching the host file company after company is the one thing that
			// catches the coincidence, so it clears nobody — including the row whose
			// name it seems to carry
			expect(
				existenceOf({
					name: 'Paginas',
					website: 'https://paginas.es',
					sources: [PAPER],
					directorySites: new Set(['paginas.es']),
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})

		it('should hold back a firm whose own site files its partners — the cost', () => {
			// GIVEN a firm at the domain its name spells, which gives each of its
			// partners a page, so the watch reads that host as a listing
			// WHEN asked
			// THEN it is held back although it plainly exists: the price of the rule
			// above, paid because a wrongly-confirmed company is the dearer mistake.
			// A second website that is not this host still clears it.
			expect(
				existenceOf({
					name: 'Instalaciones Ferré',
					website: 'https://instalacionesferre.es',
					sources: [PAPER],
					directorySites: new Set(['instalacionesferre.es']),
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})

		it('should still clear that firm from a second site of its own', () => {
			// GIVEN the same firm, cited also on the other ending it registered
			// WHEN asked
			// THEN the branding costs it that one host, never the company: a site of
			// its own that nothing watched still establishes it
			expect(
				existenceOf({
					name: 'Instalaciones Ferré',
					website: 'https://instalacionesferre.es',
					sources: [PAPER, 'https://instalacionesferre.com'],
					directorySites: new Set(['instalacionesferre.es']),
				}),
			).toEqual({ verdict: 'confirmed', websites: 2 })
		})
	})

	describe('when only one website names the company', () => {
		it('should hold back a company known only by its own site', () => {
			// GIVEN nothing but the company's own site
			// WHEN asked
			// THEN one website is not two, however well it establishes ownership
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: [`${OWN}/contacte`],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'one_website', websites: 1 })
		})

		it('should fold a subdomain onto its parent', () => {
			// GIVEN two addresses on one site, one of them a subdomain
			// WHEN asked
			// THEN two pages of one site are one source
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: ['https://blog.fusteriamiquel.cat/obra-nova'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'one_website', websites: 1 })
		})

		it('should fold www onto the bare host', () => {
			// GIVEN the same site written both ways
			// WHEN asked — THEN it is one website
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: ['https://www.fusteriamiquel.cat/contacte'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'one_website', websites: 1 })
		})

		it("should fold the company's own domain under two endings", () => {
			// GIVEN a firm holding both endings of its name, which is ordinary
			// WHEN asked
			// THEN they are one firm's two addresses, not two witnesses — otherwise
			// a company's own site would confirm it with no outside source at all
			expect(
				existenceOf({
					name: NAME,
					website: OWN,
					sources: ['https://fusteriamiquel.com'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'one_website', websites: 1 })
		})

		it('should fold a sub-brand host onto the site it sits on', () => {
			// GIVEN a listing's sub-brand and the parent it sits under
			// WHEN asked
			// THEN one website — the fold that must NOT reach the directory verdict
			// reaches the independence count, which is what it is for
			expect(
				existenceOf({
					name: NAME,
					sources: [
						'https://empresite.eleconomista.es/fusteria-miquel.html',
						'https://eleconomista.es/noticia/999',
					],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'one_website', websites: 1 })
		})
	})

	describe("when no website is established as the company's own", () => {
		it('should hold back a company known only to listings', () => {
			// GIVEN two separate listings and nothing else
			// WHEN asked
			// THEN two websites, but nothing that can clear one of them
			expect(
				existenceOf({
					name: NAME,
					sources: [LISTING, 'https://otrodirectorio.es/e/fusteria-miquel'],
					directorySites: new Set(['paginas.es', 'otrodirectorio.es']),
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})

		it('should hold back a company known only to newspapers', () => {
			// GIVEN two papers, neither of them a domain the company's name spells
			// WHEN asked
			// THEN `unknown` is not a clearance — that is the whole fail-closed
			// property, and two of them do not add up to one
			expect(
				existenceOf({
					name: NAME,
					sources: [PAPER, 'https://lavanguardia.com/economia/55'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})

		it('should hold back a company whose domain spells nothing of its name', () => {
			// GIVEN a firm at an acronym its name never spells, the cost `own-site`
			// records paying on purpose
			// WHEN asked — THEN it is a candidate, and says why
			expect(
				existenceOf({
					name: 'Sociedad Ibérica de Construcciones Eléctricas',
					website: 'https://sice.com',
					sources: [PAPER],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})

		it('should establish nothing for a row that names no company', () => {
			// GIVEN a row with no usable name
			// WHEN asked
			// THEN nothing can be established as ITS site, because there is no
			// company to establish it for
			expect(
				existenceOf({
					name: '',
					website: OWN,
					sources: [PAPER],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})

		it('should count two strangers sharing a label as two websites', () => {
			// GIVEN a row cited on two hosts that share a registered label but are
			// neither of them this company's
			// WHEN asked
			// THEN they stay two websites: merging them would withhold a
			// confirmation the evidence supports
			expect(
				existenceOf({
					name: 'Zeta Instal·lacions',
					sources: ['https://acme.es/x', 'https://acme.de/y'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_own_site', websites: 2 })
		})
	})

	describe('when nothing usable named the company', () => {
		it('should report no sources for an empty list', () => {
			// GIVEN a row citing nothing and holding no website
			// WHEN asked — THEN there is nothing to count
			expect(
				existenceOf({ name: NAME, sources: [], directorySites: NONE }),
			).toEqual({
				verdict: 'candidate',
				reason: 'no_sources',
				websites: 0,
			})
		})

		it('should never read an internal source id as a website', () => {
			// GIVEN citations written as the opaque ids the run stores pages under
			// WHEN asked
			// THEN they are screened out — unscreened, each would yield the "host"
			// src_… and two of them would make up the second website that confirms
			expect(
				existenceOf({
					name: NAME,
					sources: ['src_9f2a1b3c', 'src_aa11bb22'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_sources', websites: 0 })
		})

		it('should reject an address with words written beside it', () => {
			// GIVEN the aside a model hands back when it is unsure of a site
			// WHEN asked
			// THEN nobody can open it, so it is not a website — the strict reading,
			// because saying yes here ADDS a source
			expect(
				existenceOf({
					name: NAME,
					website: 'https://fusteriamiquel.cat/ (inferred from the name)',
					sources: ['https://elpuntavui.cat/ (probably)'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_sources', websites: 0 })
		})

		it('should ignore a website field holding only whitespace', () => {
			// GIVEN a blank website beside one real citation
			// WHEN asked — THEN the blank adds nothing and the citation stands alone
			expect(
				existenceOf({
					name: NAME,
					website: '   ',
					sources: [PAPER],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'one_website', websites: 1 })
		})

		it('should ignore a mailbox offered as a source', () => {
			// GIVEN an email address, which parses to a host but cannot be fetched
			// WHEN asked — THEN it is not a website
			expect(
				existenceOf({
					name: NAME,
					sources: ['info@fusteriamiquel.cat'],
					directorySites: NONE,
				}),
			).toEqual({ verdict: 'candidate', reason: 'no_sources', websites: 0 })
		})
	})
})

describe('rowExistence', () => {
	describe('when the row carries no verdict', () => {
		it('should read as a candidate', () => {
			// GIVEN a row nothing ever verified
			// WHEN read
			// THEN absence is never confirmation — there is no shape a row can
			// arrive in that reads as confirmed without a verdict saying so
			expect(rowExistence({ name: NAME })).toEqual({
				verdict: 'candidate',
				websites: 0,
			})
		})

		it('should read an unusable verdict as a candidate', () => {
			// GIVEN a verdict of the wrong shape entirely
			// WHEN read — THEN still a candidate
			expect(rowExistence({ existence: 'confirmed' })).toEqual({
				verdict: 'candidate',
				websites: 0,
			})
		})

		it('should read an unrecognised verdict word as a candidate', () => {
			// GIVEN a verdict naming a state this module does not have
			// WHEN read — THEN only the word 'confirmed' confirms
			expect(
				rowExistence({ existence: { verdict: 'probably', websites: 9 } }),
			).toEqual({ verdict: 'candidate', websites: 9 })
		})
	})

	describe('when the row carries a verdict', () => {
		it('should read a confirmed row', () => {
			// GIVEN a row verified as existing
			// WHEN read — THEN it reports what it rests on
			expect(
				rowExistence({ existence: { verdict: 'confirmed', websites: 3 } }),
			).toEqual({ verdict: 'confirmed', websites: 3 })
		})

		it('should carry a candidate reason through', () => {
			// GIVEN a row the run never reached before its allowance ran out
			// WHEN read
			// THEN the reason survives, because running out of money is not a
			// finding about the company and must not read as one
			expect(
				rowExistence({
					existence: {
						verdict: 'candidate',
						reason: 'budget_exhausted',
						websites: 0,
					},
				}),
			).toEqual({
				verdict: 'candidate',
				reason: 'budget_exhausted',
				websites: 0,
			})
		})

		it('should read a missing website count as none', () => {
			// GIVEN a verdict written without its count
			// WHEN read — THEN the count reads as nought rather than as missing
			expect(rowExistence({ existence: { verdict: 'confirmed' } })).toEqual({
				verdict: 'confirmed',
				websites: 0,
			})
		})
	})
})

describe('withExistence', () => {
	it("should write the verdict without disturbing the row's own fields", () => {
		// GIVEN a row with fields of its own
		// WHEN a verdict is written onto it
		// THEN everything it already held is still there
		const row = withExistence(
			{ name: NAME, website: OWN },
			{ verdict: 'confirmed', websites: 2 },
		)
		expect(row).toEqual({
			name: NAME,
			website: OWN,
			existence: { verdict: 'confirmed', websites: 2 },
		})
	})

	it('should replace a verdict already on the row', () => {
		// GIVEN a row verified once already
		// WHEN verified again — THEN the later answer is the one held
		expect(
			rowExistence(
				withExistence(
					{
						existence: {
							verdict: 'candidate',
							reason: 'no_sources',
							websites: 0,
						},
					},
					{ verdict: 'confirmed', websites: 2 },
				),
			),
		).toEqual({ verdict: 'confirmed', websites: 2 })
	})
})

describe('isConfirmedRow', () => {
	it('should answer for a row either way', () => {
		// GIVEN one verified row and one that never was
		// WHEN each is asked — THEN only the verified one is stood behind
		expect(
			isConfirmedRow({ existence: { verdict: 'confirmed', websites: 2 } }),
		).toBe(true)
		expect(isConfirmedRow({ name: NAME })).toBe(false)
	})
})

describe('resultNamesCompany', () => {
	// A search result, with only the part under test filled in.
	const result = (
		over: Partial<{ title: string; snippet: string; url: string }>,
	) => ({ title: '', snippet: '', url: 'https://nothing.example/', ...over })

	describe('when the result really is about the company', () => {
		it('should read the name out of the title', () => {
			// GIVEN a result whose title names the company, legal form and all
			// WHEN read — THEN the form does not stop it being the same company
			expect(
				resultNamesCompany(
					NAME,
					result({ title: 'Fusteria Miquel SL - fusters a Girona' }),
				),
			).toBe(true)
		})

		it('should read the name out of the snippet', () => {
			// GIVEN a result naming the company only in its text
			expect(
				resultNamesCompany(
					NAME,
					result({ snippet: 'Contacte amb Fusteria Miquel, a Girona' }),
				),
			).toBe(true)
		})

		it('should read the name out of one part of the address', () => {
			// GIVEN a paper filing its piece under the company's name
			expect(
				resultNamesCompany(
					NAME,
					result({ url: 'https://elpuntavui.cat/fusteria-miquel-obra' }),
				),
			).toBe(true)
		})

		it('should read the name out of the host', () => {
			// GIVEN the company's own domain, which spells it with no separators
			expect(
				resultNamesCompany(
					NAME,
					result({ url: 'https://fusteriamiquel.cat/' }),
				),
			).toBe(true)
		})
	})

	describe('when the address spells the name its own way', () => {
		it('should read a name however the page writes it', () => {
			// GIVEN a Catalan name carrying a geminate, and a form written in dots —
			// both of which a page writes differently from the row
			// WHEN read
			// THEN the company is still recognised. This is the same reading the
			// directory watch files a company under, so one run cannot spot a
			// company in an address and fail to spot it here
			expect(
				resultNamesCompany(
					'Instal·lacions Vidal',
					result({ url: 'https://elpuntavui.cat/installacions-vidal-obra' }),
				),
			).toBe(true)
			expect(
				resultNamesCompany(
					'Muñoz S.L.',
					result({ title: 'Munoz SL, fabricants' }),
				),
			).toBe(true)
		})
	})

	describe('when the result is about somebody else', () => {
		it('should refuse a name formed across a boundary in the address', () => {
			// GIVEN a listing's page ABOUT Garcia Hermanos, filed under a trade
			// WHEN read
			// THEN the trade and the other firm's name do not run together into a
			// company neither of them is. Read end to end this address spells
			// "Instalaciones Garcia", and this is the commonest shape a search for a
			// company returns — so the loose reading would manufacture a second
			// source on the most ordinary result there is
			expect(
				resultNamesCompany(
					'Instalaciones Garcia',
					result({ url: 'https://paginas.es/instalaciones/garcia-hermanos' }),
				),
			).toBe(false)
			expect(
				resultNamesCompany(
					'Talleres Ferrer',
					result({ url: 'https://directorio.es/talleres/ferrer-e-hijos' }),
				),
			).toBe(false)
		})

		it('should refuse a longer word the name only opens', () => {
			// GIVEN a firm whose name begins the same way
			// WHEN read — THEN the name has to be spelled, not merely started
			expect(
				resultNamesCompany(
					'Acme Solar',
					result({ title: 'Acme Solaris Ltd, a different firm' }),
				),
			).toBe(false)
		})

		it('should refuse the name split across the words of a sentence', () => {
			// GIVEN a page about another firm that happens to use the trade word
			// WHEN read — THEN the words have to sit together in that order
			expect(
				resultNamesCompany(
					'Instalaciones Garcia',
					result({ title: 'Garcia Hermanos - instalaciones electricas' }),
				),
			).toBe(false)
		})
	})

	describe('when there is not enough name to look for', () => {
		it('should match nothing rather than everything', () => {
			// GIVEN a row with no name, or one that is nothing but a legal form
			// WHEN read — THEN nothing names it, which is the safe answer
			expect(resultNamesCompany('', result({ title: 'anything at all' }))).toBe(
				false,
			)
			expect(resultNamesCompany('SL', result({ title: 'sl sl sl' }))).toBe(
				false,
			)
		})
	})
})

describe('markRowsExistence', () => {
	it('should write a verdict onto each row of the list, in order', () => {
		// GIVEN a list of two companies
		// WHEN each is marked by position
		// THEN each row keeps its own answer
		const marked = markRowsExistence(
			{ prospects: [{ name: 'A' }, { name: 'B' }] },
			'prospects',
			(_row, at) => ({
				verdict: 'candidate',
				reason: at === 0 ? 'no_sources' : 'one_website',
				websites: at,
			}),
		) as { prospects: Array<Record<string, unknown>> }
		expect(marked.prospects.map(row => rowExistence(row).reason)).toEqual([
			'no_sources',
			'one_website',
		])
	})

	it('should leave a list of the same name buried deeper alone', () => {
		// GIVEN a proposed update whose free-form blob decoded to an object
		// carrying a key of the same name — the blob holds whatever the model
		// wrote, so this is reachable
		const findings = {
			prospects: [{ name: 'Real A' }, { name: 'Real B' }],
			proposed_updates: [
				{ fields: { prospects: [{ name: 'Nested X' }] }, reason: 'r' },
			],
		}

		// WHEN the list is marked
		const seen: Array<readonly [string, number]> = []
		const marked = markRowsExistence(findings, 'prospects', (row, at) => {
			seen.push([String(row['name']), at] as const)
			return { verdict: 'candidate', reason: 'no_sources', websites: 0 }
		}) as Record<string, unknown>

		// THEN only the list the run reports is visited. A deeper one would
		// restart the count, and the answers are looked up by position — so the
		// stranger would be handed the first company's reason and carry a verdict
		// nobody worked out for it
		expect(seen).toEqual([
			['Real A', 0],
			['Real B', 1],
		])
		const [update] = marked['proposed_updates'] as Array<
			Record<string, unknown>
		>
		const blob = update?.['fields'] as Record<string, unknown>
		const buried = blob['prospects'] as Array<Record<string, unknown>>
		expect(buried[0]).toEqual({ name: 'Nested X' })
	})

	it('should hand back findings that hold no list untouched', () => {
		// GIVEN findings whose list key is missing or is not a list
		// WHEN marked — THEN nothing is invented and nothing throws
		expect(
			markRowsExistence({ enrichment: {} }, 'prospects', () => ({
				verdict: 'confirmed',
				websites: 2,
			})),
		).toEqual({ enrichment: {} })
		expect(
			markRowsExistence(null, 'prospects', () => ({
				verdict: 'confirmed',
				websites: 2,
			})),
		).toBe(null)
	})

	it('should step over a row that is not an object without spending its place', () => {
		// GIVEN a list holding something that is not a company
		// WHEN marked
		// THEN the count follows the rows a reader gets, so the answers stay lined
		// up with them
		const seen: Array<number> = []
		markRowsExistence(
			{ prospects: [{ name: 'A' }, 'rubbish', { name: 'B' }] },
			'prospects',
			(_row, at) => {
				seen.push(at)
				return { verdict: 'candidate', reason: 'no_sources', websites: 0 }
			},
		)
		expect(seen).toEqual([0, 1])
	})
})

describe('partitionByExistence', () => {
	it('should split the one list into the two groups a reader is given', () => {
		// GIVEN a list holding both kinds
		// WHEN split
		// THEN each row lands in exactly one group, and none is dropped
		const confirmed = {
			name: 'A',
			existence: { verdict: 'confirmed', websites: 2 },
		}
		const thin = {
			name: 'B',
			existence: { verdict: 'candidate', reason: 'one_website', websites: 1 },
		}
		const unchecked = { name: 'C' }
		const groups = partitionByExistence([confirmed, thin, unchecked])
		expect(groups.confirmed).toEqual([confirmed])
		expect(groups.candidates).toEqual([thin, unchecked])
	})

	it('should hand back two empty groups for an empty list', () => {
		// GIVEN no rows at all
		// WHEN split — THEN neither group invents one
		expect(partitionByExistence([])).toEqual({ confirmed: [], candidates: [] })
	})
})
