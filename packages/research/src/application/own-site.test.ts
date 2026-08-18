import { describe, expect, it } from 'vitest'

import { ownSiteHostVerdict, ownSiteVerdict } from './own-site'

// The address the French solar directory files a company at: a slug naming a
// trade and a role, ending in the listing's own record number, and naming no
// company.
const TECSOL_LISTING =
	'https://annuaire.tecsol.fr/liste-fournisseur-solaire-installateurs-epc-339615/'

describe('ownSiteVerdict', () => {
	describe('when the domain spells the company name', () => {
		it('should establish a domain carrying the whole name', () => {
			// GIVEN a company at the domain its full name spells
			// WHEN asked whose site it is
			// THEN the domain itself is the answer, whatever page the address points at
			expect(
				ownSiteVerdict({
					name: 'Redwood Logistics',
					website: 'https://redwoodlogistics.com/about',
				}),
			).toBe('established')
		})

		it('should establish a domain carrying the front of the name', () => {
			// GIVEN a company that registered less than its full name, which is how a
			// firm usually shortens one
			// WHEN asked — THEN the front part it kept spells it just as well
			expect(
				ownSiteVerdict({
					name: 'Acme Logistics',
					website: 'https://acme.com',
				}),
			).toBe('established')
		})

		it('should establish a three-letter domain the name opens with', () => {
			// GIVEN the large carriers, whose names open with an initialism too short
			// for any check that goes on a fragment
			// WHEN asked
			// THEN each is at home on its own domain. A label that IS the whole front
			// of the name is exact, so it says as much at three letters as at ten —
			// and losing these would take the biggest names in the market with it
			for (const [name, website] of [
				['XPO Logistics', 'https://xpo.com/about-xpo-logistics'],
				['DSV', 'https://dsv.com/about-dsv'],
				['SEUR', 'https://seur.com/sobre-seur'],
				['ASM', 'https://asm.es/quienes-somos'],
				['TIBA Group', 'https://tiba-group.com/about-tiba'],
				['GLS Spain', 'https://gls-spain.es/gls-spain-quienes'],
			] as const) {
				expect(ownSiteVerdict({ name, website })).toBe('established')
			}
		})

		it('should establish a domain that is one distinctive word of the name', () => {
			// GIVEN the way most small firms register: the one word of the name
			// people actually use, which is not the front of it
			// WHEN asked — THEN that word standing alone is the company
			expect(
				ownSiteVerdict({
					name: 'Transportes García',
					website: 'https://garcia.es/contacto',
				}),
			).toBe('established')
		})

		it('should establish a domain with the legal form tacked on', () => {
			// GIVEN a Catalan workshop whose domain writes its form after its name
			// WHEN asked — THEN a form on the end is the company still writing itself
			expect(
				ownSiteVerdict({
					name: 'Fusteria Miquel',
					website: 'https://fusteriamiquelsl.cat',
				}),
			).toBe('established')
		})

		it('should read a name whose form is written with dots', () => {
			// GIVEN the same company written the other Spanish way, form in dots
			// WHEN asked — THEN the dots are taken out before the name is read, so one
			// company spelled two ways is not two answers
			expect(
				ownSiteVerdict({ name: 'Acme S.L.', website: 'https://acme.com' }),
			).toBe('established')
		})

		it('should read a name whose accents the domain drops', () => {
			// GIVEN an accented name and the unaccented domain a registrar hands out
			// WHEN asked — THEN accents are folded away on both sides
			expect(
				ownSiteVerdict({ name: 'Grupo Muñoz', website: 'https://munoz.es' }),
			).toBe('established')
		})

		it('should read past a subdomain and a country second level', () => {
			// GIVEN the company's site reached at a subdomain, and at a country domain
			// with a public second level in it
			// WHEN asked — THEN the label the domain is registered under is what is
			// read, so neither hides the company
			expect(
				ownSiteVerdict({
					name: 'Acme Logistics',
					website: 'https://botiga.acme.co.uk/contacte',
				}),
			).toBe('established')
		})
	})

	describe('when the domain merely contains the name', () => {
		it('should not establish a domain with something else appended', () => {
			// GIVEN a site whose domain carries the company's name and then some
			// WHEN asked
			// THEN nothing is established. Whoever registered "acme-directory" writes
			// ABOUT Acme, and a listing whose domain happens to carry a word of the
			// name would otherwise clear itself
			expect(
				ownSiteVerdict({
					name: 'Acme Logistics',
					website: 'https://acme-directory.com/acme-logistics',
				}),
			).toBe('unknown')
		})

		it('should not establish a domain the name sits inside', () => {
			// GIVEN a company's real site at a domain that puts a word of its own in
			// front of the name
			// WHEN asked
			// THEN unknown, and this is the price rather than a bug: the address is
			// still kept, what it loses is standing as the thing that vouches for the
			// company. Pinned so the cost stays visible instead of being met in a run
			expect(
				ownSiteVerdict({
					name: 'Penske Logistics',
					website: 'https://gopenske.com/logistics',
				}),
			).toBe('unknown')
		})
	})

	describe('when only a trade word would match', () => {
		it('should not establish a domain spelling the trade a name opens with', () => {
			// GIVEN a company whose name opens with the word for what it does
			// WHEN asked
			// THEN unknown: "grupo" identifies nobody, and grupo.es belongs to
			// whoever registered it rather than to every company called Grupo
			// something
			expect(
				ownSiteVerdict({ name: 'Grupo Ferré', website: 'https://grupo.es' }),
			).toBe('unknown')
		})

		it('should establish the same name once its own word is in the domain', () => {
			// GIVEN the same company at the domain that adds the family name
			// WHEN asked — THEN the run that carries a word of the company's own is
			// the company
			expect(
				ownSiteVerdict({
					name: 'Grupo Ferré',
					website: 'https://grupoferre.es',
				}),
			).toBe('established')
		})

		it('should not establish anything for a name that is only trade words', () => {
			// GIVEN a name with nothing in it but what the company does
			// WHEN asked — THEN there is no name to look for, so no domain can spell
			// it
			expect(
				ownSiteVerdict({
					name: 'Logistics Group',
					website: 'https://logistics.com',
				}),
			).toBe('unknown')
		})
	})

	describe('when the address is a page rather than a site', () => {
		it('should not establish a listing page naming the company in its path', () => {
			// GIVEN a directory's page about the company
			// WHEN asked — THEN a path names a PAGE about the company, and who
			// publishes a page about a company is the question, not the answer
			expect(
				ownSiteVerdict({
					name: 'Redwood Logistics',
					website: 'https://cbinsights.com/company/redwood-logistics',
				}),
			).toBe('unknown')
		})

		it('should not establish a page naming the company in the first segment', () => {
			// GIVEN the shape the website guard exempts from blanking, on a host that
			// is nobody's: a social platform's page for the company
			// WHEN asked
			// THEN unknown. From the address alone this is the same shape as a
			// company's own "about us" page, so the exemption that protects the
			// carriers there is no reason to claim ownership here — what saves them
			// is their own domain, which this host is not
			expect(
				ownSiteVerdict({
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
				}),
			).toBe('unknown')
		})

		it('should not establish a bare host that names the company nowhere', () => {
			// GIVEN a directory's home page handed back as a company's website
			// WHEN asked — THEN with no path there is nothing to condemn either, which
			// is exactly why "not condemned" cannot stand in for "owned"
			expect(
				ownSiteVerdict({
					name: 'KBE Energy',
					website: 'https://annuaire.tecsol.fr',
				}),
			).toBe('unknown')
		})

		it('should not establish a slug that happens to carry a word of the name', () => {
			// GIVEN a listing whose trade slug coincidentally spells a word of the
			// company's name
			// WHEN asked — THEN the coincidence buys nothing, because the path is not
			// read at all
			expect(
				ownSiteVerdict({
					name: 'KBE Energy',
					website: 'https://annuaire.fr/energy-installateurs-12345',
				}),
			).toBe('unknown')
		})

		it('should not establish a listing page whose address names no company', () => {
			// GIVEN a French solar directory's listing page recorded as a company's
			// own site
			// WHEN asked — THEN unknown, and neither the page nor anything the row
			// cites could change that, since neither is read
			expect(
				ownSiteVerdict({ name: 'KBE Energy', website: TECSOL_LISTING }),
			).toBe('unknown')
		})
	})

	describe('when what came in is a question rather than a name', () => {
		it('should establish nothing from a word of a whole market question', () => {
			// GIVEN the question a market search is launched with, handed down as the
			// company's name — which is what a run with no company on file passes
			const question =
				'Empresas instaladoras en España: instalaciones eléctricas, ' +
				'fontanería y climatización, energía solar fotovoltaica'

			// WHEN a website is asked about against it
			// THEN unknown. Every long word of a question would otherwise be a word a
			// domain could be cleared by, and a run that does not know the company's
			// name cannot say whose site anything is
			expect(
				ownSiteVerdict({ name: question, website: 'https://fontaneria.es' }),
			).toBe('unknown')
			expect(
				ownSiteVerdict({ name: question, website: 'https://empresas.es' }),
			).toBe('unknown')
		})

		it('should still establish a long name that is genuinely a name', () => {
			// GIVEN one of the longest names a real company carries
			// WHEN asked — THEN the bar sits well clear of it, so a company is not
			// refused for being called something long
			expect(
				ownSiteVerdict({
					name: 'Sociedad Española de Montajes Industriales SA',
					website: 'https://sociedadespanola.es',
				}),
			).toBe('established')
		})
	})

	describe('when the domain is shorter than a name', () => {
		it('should not establish a domain matching a single initial', () => {
			// GIVEN a company whose name opens with an initial
			// WHEN asked — THEN one letter is an initial rather than a name, and a
			// domain that short belongs to whoever paid for it
			expect(
				ownSiteVerdict({ name: 'A. Martín', website: 'https://a.com' }),
			).toBe('unknown')
		})

		it('should establish a three-letter domain, which the carriers register', () => {
			// GIVEN the shortest domain a real company here is at
			// WHEN asked — THEN three letters stand, so the floor cannot be raised
			expect(
				ownSiteVerdict({ name: 'Fer Corporation', website: 'https://fer.org' }),
			).toBe('established')
		})
	})

	describe('when the domain writes a legal form after the name', () => {
		it('should establish it after a distinctive word, not only after the front', () => {
			// GIVEN a company known by an acronym its own name carries, at the domain
			// that writes that acronym and its form
			// WHEN asked
			// THEN established. The form is allowed after whichever part of the name
			// the domain spells — reading it after the front of a name but not after
			// one of its words would be the same rule answering two ways
			expect(
				ownSiteVerdict({
					name: 'Sociedad Española de Montajes Industriales SA (SEMI)',
					website: 'https://www.semi-sa.com',
				}),
			).toBe('established')
		})
	})

	describe('when there is nothing to read', () => {
		it('should not establish anything without a name to compare', () => {
			// GIVEN a real company site and no name beside it — an open-ended run, or
			// a target the run was never told the name of
			// WHEN asked — THEN unknown rather than missing: a run with no name
			// establishes nothing, which is an answer
			expect(ownSiteVerdict({ name: '', website: 'https://acme.com' })).toBe(
				'unknown',
			)
		})

		it('should not establish anything for a name that is only a legal form', () => {
			// GIVEN a row whose whole name is the form
			// WHEN asked — THEN the form is taken out and nothing is left to look for
			expect(ownSiteVerdict({ name: 'S.L.', website: 'https://sl.com' })).toBe(
				'unknown',
			)
		})

		it('should not establish a value with words written beside the address', () => {
			// GIVEN the model's aside glued onto the address, which the URL parser
			// hides by folding the words into the path
			// WHEN asked — THEN unknown: there is no single domain to read, and
			// nobody could open the value either
			expect(
				ownSiteVerdict({
					name: 'ADIME',
					website: 'https://adime.org/ (not directly provided, inferred)',
				}),
			).toBe('unknown')
		})

		it('should not establish a value that is not an address', () => {
			// GIVEN values no reader could open
			// WHEN asked — THEN each is unknown
			for (const website of ['not a url', '', 'info@acme.es', 'src_9f2a1b3c']) {
				expect(ownSiteVerdict({ name: 'Acme', website })).toBe('unknown')
			}
		})

		it('should not establish a numeric host', () => {
			// GIVEN a site given by its address on the network rather than by name
			// WHEN asked — THEN nothing in the numbers spells a company
			expect(
				ownSiteVerdict({ name: 'Acme', website: 'http://192.168.1.10/acme' }),
			).toBe('unknown')
		})
	})

	describe('when the same address is judged for a different company', () => {
		it('should establish it only for the company the domain names', () => {
			// GIVEN one company's own site, offered as two different companies'
			// WHEN each is asked
			// THEN the domain answers for its own company and for nobody else, so a
			// row handed somebody else's site gets no clearance from it
			const website = 'https://acme.com/quienes-somos'
			expect(ownSiteVerdict({ name: 'Acme Logistics', website })).toBe(
				'established',
			)
			expect(ownSiteVerdict({ name: 'Instalaciones Rubio', website })).toBe(
				'unknown',
			)
		})
	})

	describe('when the name is written with a geminated l', () => {
		it('should establish the domain whichever way it spells the name', () => {
			// GIVEN a Catalan company and the two domains it might have registered
			// WHEN each is asked
			// THEN both are its own. A firm registers the spelling it prefers, and
			// the run must not decide the other one belongs to somebody else
			for (const website of [
				'https://installacionsvives.cat',
				'https://instalacionsvives.cat/contacte',
			]) {
				expect(
					ownSiteVerdict({ name: 'Instal·lacions Vives SL', website }),
				).toBe('established')
			}
		})

		it('should not hand one company a look-alike name s domain', () => {
			// GIVEN two different companies whose names differ only by a doubled l,
			// neither of which marks a geminate
			// WHEN each is offered the other's domain
			// THEN neither is established. Only a name that carries the mark is read
			// two ways, so an ordinary doubled l keeps the two apart
			expect(
				ownSiteVerdict({
					name: 'Vila Nova SL',
					website: 'https://villanova.cat',
				}),
			).toBe('unknown')
			expect(
				ownSiteVerdict({
					name: 'Villa Nova SL',
					website: 'https://vilanova.cat',
				}),
			).toBe('unknown')
		})
	})

	describe('when the name uses letters a web address cannot carry', () => {
		it('should establish the domain the company actually registered', () => {
			// GIVEN companies from six languages, each at its own site, whose names
			// hold a letter that is not an accented a–z one
			// WHEN each is asked
			// THEN each is its own. Drop the letter instead of writing it out and
			// "Straßenbau" reads as "straenbau" — a name nobody spells, so the company
			// is looked for under it and its own site comes back as a stranger's
			for (const [name, website] of [
				['Straßenbau Weber GmbH', 'https://strassenbau-weber.de'],
				['Nørgaard VVS', 'https://norgaard-vvs.dk'],
				['Łukasz Instalacje', 'https://lukasz-instalacje.pl'],
				['Cœur Énergie', 'https://coeur-energie.fr'],
				['Þór Raflagnir', 'https://thor-raflagnir.is'],
				['Işık Elektrik', 'https://isik-elektrik.com.tr'],
			] as const) {
				expect(ownSiteVerdict({ name, website })).toBe('established')
			}
		})

		it('should establish it whichever way the domain writes the vowel', () => {
			// GIVEN one German company, at each of the two domains it might have
			// registered
			// WHEN each is asked
			// THEN both are its own: the plain letter and the two-letter form are the
			// same name, and a firm picks one when it registers
			for (const website of [
				'https://muller-elektro.de',
				'https://mueller-elektro.de',
			]) {
				expect(ownSiteVerdict({ name: 'Müller Elektro GmbH', website })).toBe(
					'established',
				)
			}
		})

		it("should not hand a company a look-alike name's domain", () => {
			// GIVEN companies whose names are near neighbours of one another once the
			// letters are written out
			// WHEN each is offered the other's domain
			// THEN none is established. Writing a letter out is not the same as
			// letting any two names that end up near each other match
			for (const [name, website] of [
				['Muller SL', 'https://mueller.de'],
				['Mueller GmbH', 'https://muller.de'],
				['Rose GmbH', 'https://rosse.de'],
				['Sander AS', 'https://sonder.no'],
			] as const) {
				expect(ownSiteVerdict({ name, website })).toBe('unknown')
			}
		})
	})
})

describe('ownSiteHostVerdict', () => {
	describe('when a host is asked about directly', () => {
		it('should establish a domain that spells the front of the name', () => {
			// GIVEN a group's domain, and the group and its subsidiary as two rows
			// WHEN each name is asked about the host
			// THEN the front of a name is enough, so the domain is established as
			// each of their own — which is what the directory watch steps over
			expect(
				ownSiteHostVerdict({
					name: 'D-Sécurité (groupe)',
					host: 'd-securite.com',
				}),
			).toBe('established')
			expect(
				ownSiteHostVerdict({
					name: 'D-Sécurité Incendie',
					host: 'd-securite.com',
				}),
			).toBe('established')
		})

		it('should leave a host that merely carries the name unknown', () => {
			// GIVEN a listing whose domain has a company's name inside it
			// WHEN asked
			// THEN the label has to BE the name, never merely contain it
			expect(
				ownSiteHostVerdict({ name: 'Acme', host: 'acme-directorio.example' }),
			).toBe('unknown')
		})

		it('should leave a host unknown for a name of nothing but trade words', () => {
			// GIVEN a name holding no word of the company's own
			// WHEN asked
			// THEN there is no word of its own for a domain to spell
			expect(
				ownSiteHostVerdict({ name: 'Grupo Express SL', host: 'grupo.example' }),
			).toBe('unknown')
		})

		it('should establish nothing without a name to compare', () => {
			// GIVEN a run with no company name
			// WHEN asked
			// THEN an empty name must not be spelled by every host there is
			expect(ownSiteHostVerdict({ name: '', host: 'acme.com' })).toBe('unknown')
		})
	})

	describe('when the same site is asked about both ways', () => {
		it('should answer a host exactly as it answers an address on it', () => {
			// GIVEN one company's own site, and several addresses on it
			// WHEN the host is asked directly and each address is asked
			// THEN the two agree, which is what lets a caller weighing many
			// addresses on one host ask once for the host
			const name = 'Fusteria Miquel'
			const host = 'fusteriamiquel.cat'
			for (const website of [
				'https://fusteriamiquel.cat',
				'https://www.fusteriamiquel.cat/qui-som',
				'https://fusteriamiquel.cat/obra/2024/cuina',
			]) {
				expect(ownSiteVerdict({ name, website })).toBe(
					ownSiteHostVerdict({ name, host }),
				)
			}
		})

		it('should not screen a host the way an address is screened', () => {
			// GIVEN a website value with words written beside the address
			// WHEN put to each
			// THEN the address reading refuses it, while the host reading trusts its
			// caller to have read a host off an address already
			expect(
				ownSiteVerdict({
					name: 'Fusteria Miquel',
					website: 'https://fusteriamiquel.cat/ (inferred from the name)',
				}),
			).toBe('unknown')
			expect(
				ownSiteHostVerdict({
					name: 'Fusteria Miquel',
					host: 'fusteriamiquel.cat',
				}),
			).toBe('established')
		})
	})
})
