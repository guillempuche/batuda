import { describe, expect, it } from 'vitest'

import {
	cityGate,
	classifyEntityMatch,
	classifyEntityMatchPerSource,
	coreSpellings,
	deriveAnchorHost,
	deriveEntityTargets,
	distinctiveWords,
	domainHost,
	type EntityTargets,
	groundedSourceIds,
	hostLabel,
	isConfirmedRegistryMatch,
	isOwnSiteHost,
	labelSpellsOneOf,
	nameSpellings,
	namesNobodyInParticular,
	parseQueryDomain,
	placesCorroborate,
	queryPlaces,
	reachedOwnSite,
	registrableDomain,
	spellingsWithoutForms,
	withRedirectDomain,
} from './entity-guard'

describe('deriveEntityTargets', () => {
	describe('when the schema reports third-party companies', () => {
		it('should return null for a scan or freeform run with no anchored subject', () => {
			// GIVEN a scan/freeform run whose findings are legitimately about other
			// companies, so its own query name need not dominate the evidence
			// WHEN targets are derived with no subjects
			// THEN the run is not entity-gated
			for (const schemaName of [
				'prospect_scan_v1',
				'competitor_scan_v1',
				'freeform',
			]) {
				expect(
					deriveEntityTargets({ schemaName, query: 'anything', subjects: [] }),
				).toBeNull()
			}
		})
	})

	describe('when a legal form opens the name instead of closing it', () => {
		it('should keep it, so the key is more than an industry word', () => {
			// GIVEN a company whose name opens with two letters that also spell a
			// legal form, and closes with a real one
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'KG Motors Inc.',
				subjects: [{ table: 'companies', name: 'KG Motors Inc.' }],
			})

			// THEN only the trailing form comes off, so the key is the company's own
			// name. A key of just "motors" would be carried by any page about any car
			// maker, and the run would confirm one of those as readily as this company
			expect(targets?.cores).toContain('kgmotors')
			expect(targets?.cores).not.toContain('motors')
			expect(
				classifyEntityMatch(
					targets as EntityTargets,
					'General Motors reported record sales in Detroit.',
				),
			).not.toBe('strong')
		})

		it('should read a form written in two halves off the end', () => {
			// GIVEN a Mexican company whose form is joined by a connecting word
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Grupo Ejemplo SA de CV',
				subjects: [{ table: 'companies', name: 'Grupo Ejemplo SA de CV' }],
			})

			// THEN both halves come off, so a page writing the trading name matches.
			// The connecting word is only stepped over between two halves of a form —
			// on its own it stays, or "Serveis i Manteniments" would lose its middle
			expect(targets?.cores).toContain('grupoejemplo')
		})

		it('should still drop a trailing form so both spellings agree', () => {
			// GIVEN the same company written with and without its legal form
			const withForm = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Acme Logistics SL',
				subjects: [{ table: 'companies', name: 'Acme Logistics SL' }],
			})

			// THEN the form at the end is still dropped, so a page writing the bare
			// name matches the company as filed
			expect(withForm?.cores).toContain('acmelogistics')
		})
	})

	describe('when the run is entity-centric', () => {
		it('should derive keys from the query for a query-only enrichment', () => {
			// GIVEN a company_enrichment_v1 run identified only by a free-text query
			// WHEN targets are derived
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Sunset Transportation, St. Louis MO',
				subjects: [],
			})
			// THEN the pre-comma company name becomes the strong-match core
			expect(targets?.cores).toContain('sunsettransportation')
		})

		it('should read the company name from a quoted phrase in an instruction query', () => {
			// GIVEN an instruction-style query that names the company in quotes and
			// then adds its domain and location (how the MCP client phrases runs)
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query:
					'Research "Ascent Global Logistics" (ascentgl.com, Belleville, MI) — a US 3PL. Find headcount.',
				subjects: [],
			})
			// THEN the quoted name — not the whole sentence — becomes the core, so it
			// can actually match the company's own pages
			expect(targets?.cores).toContain('ascentgloballogistics')
			expect(targets?.cores).not.toContain(
				'researchascentgloballogisticsascentglcom',
			)
		})

		it('should read the company name from curly quotes too', () => {
			// GIVEN a query whose name is wrapped in typographic quotes
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Look up “Cohitech”, Balsareny',
				subjects: [],
			})
			// THEN the curly-quoted phrase is the core
			expect(targets?.cores).toContain('cohitech')
		})

		it('should derive keys from the subject name and website when anchored', () => {
			// GIVEN any schema but with an anchored company subject
			const targets = deriveEntityTargets({
				schemaName: 'freeform',
				query: 'unused',
				subjects: [
					{
						table: 'companies',
						name: 'Acme Widgets',
						website: 'https://acme.com',
					},
				],
			})
			// THEN the name core is a strong key and the full host is a domain key
			expect(targets?.cores).toContain('acmewidgets')
			expect(targets?.domains).toContain('acme.com')
		})
	})

	describe('when the target has no usable identity', () => {
		it('should return null so nothing false-fails', () => {
			// GIVEN an anchored subject with neither a name nor a website
			// WHEN targets are derived
			// THEN the gate is skipped rather than failing an unidentifiable run
			expect(
				deriveEntityTargets({
					schemaName: 'company_enrichment_v1',
					query: '',
					subjects: [{ table: 'companies' }],
				}),
			).toBeNull()
		})
	})
})

describe('withRedirectDomain', () => {
	const baseTargets: EntityTargets = {
		cores: ['ascentgloballogistics'],
		words: ['ascent'],
		domains: ['ascentgl.com'],
		places: [],
	}

	describe('when the anchor domain redirected to a new host', () => {
		it('should fold the destination host in as a strong-match key', () => {
			// GIVEN targets built from the caller's old domain, and a rebrand
			// destination the fetch resolved to
			// WHEN the destination host is folded in
			const folded = withRedirectDomain(baseTargets, 'ascentlogistics.com')
			// THEN both hosts are strong-match domains and the new label is a weak key
			expect(folded.domains).toEqual(['ascentgl.com', 'ascentlogistics.com'])
			expect(folded.words).toContain('ascentlogistics')
			// AND a page under the new host now strong-matches
			expect(
				classifyEntityMatch(folded, 'see https://ascentlogistics.com/'),
			).toBe('strong')
		})

		it('should leave the name cores untouched', () => {
			// GIVEN any targets
			// WHEN a destination host is folded in
			// THEN the name cores are unchanged (only domain/word keys grow)
			expect(withRedirectDomain(baseTargets, 'ascentlogistics.com').cores).toBe(
				baseTargets.cores,
			)
		})
	})

	describe('when the destination is already a target domain', () => {
		it('should return the targets unchanged', () => {
			// GIVEN a destination host that is already a known domain (no real redirect)
			// WHEN it is folded in
			// THEN the same targets come back, unmodified
			expect(withRedirectDomain(baseTargets, 'ascentgl.com')).toBe(baseTargets)
		})
	})
})

describe('classifyEntityMatch', () => {
	const acme: EntityTargets = {
		cores: ['acmelogistics'],
		words: ['acme'],
		domains: ['acme.com'],
		places: [],
	}

	describe('when the evidence names the target strongly', () => {
		it('should return strong on a full-name match regardless of spacing and legal form', () => {
			// GIVEN a corpus that spells the whole name with a legal form appended
			// WHEN classified
			// THEN the match is strong (folding makes "Acme Logistics S.L." == the core)
			expect(
				classifyEntityMatch(acme, 'Contact Acme Logistics S.L. for a quote'),
			).toBe('strong')
		})

		it('should return strong on the target host, not a passing brand mention', () => {
			// GIVEN a corpus that references the company's own host
			// WHEN classified
			// THEN reaching the target's own site is a strong signal
			expect(
				classifyEntityMatch(acme, 'Homepage at https://www.acme.com/about'),
			).toBe('strong')
		})

		it('should match a name across diacritics', () => {
			// GIVEN a target whose name carries accents
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Cafés Ordóñez',
				subjects: [],
			})
			// WHEN a corpus writes the same name without the accents
			// THEN folding makes the two equal and the match is strong
			expect(classifyEntityMatch(targets!, 'the cafes ordonez brand')).toBe(
				'strong',
			)
		})
	})

	describe('when the evidence only hints at the target', () => {
		it('should return weak when a lone distinctive word appears', () => {
			// GIVEN a corpus that mentions the distinctive word but never the full
			// name or domain
			// WHEN classified
			// THEN the match is weak — it might be the target, not confidently
			expect(
				classifyEntityMatch(acme, 'A profile listing for Acme on a directory'),
			).toBe('weak')
		})
	})

	describe('when the evidence is about a different company', () => {
		it('should return absent so the run fails closed', () => {
			// GIVEN a corpus that names neither the company, its words, nor its domain
			// WHEN classified
			// THEN nothing grounds the target and the verdict is absent
			expect(
				classifyEntityMatch(acme, 'Topia Freight scored 100/100 on LoadWrap'),
			).toBe('absent')
		})

		it('should return absent for a non-existent company whose name is nowhere in the evidence', () => {
			// GIVEN the exact misattribution case: a made-up company
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Zxqvon Interstellar Freight Brokerage LLC',
				subjects: [],
			})
			// WHEN its keys are classified against a corpus about other freight firms
			// THEN the run is absent (its distinctive words appear nowhere)
			expect(
				classifyEntityMatch(targets!, 'Topia and Sunset are freight brokers'),
			).toBe('absent')
		})
	})
})

describe('isConfirmedRegistryMatch', () => {
	const targets = deriveEntityTargets({
		schemaName: 'company_enrichment_v1',
		query: 'Acme Logistics, Barcelona',
		subjects: [],
	})

	describe('when the lookup resolved the target company', () => {
		it('should confirm on a legal name that strongly matches the target', () => {
			// GIVEN a resolved record whose legal name spells the target with a legal form
			// WHEN checked against the target's keys
			// THEN the registry lookup confirms the run reached the right company
			expect(
				isConfirmedRegistryMatch(targets, {
					legalName: 'ACME LOGISTICS SL',
					taxId: 'B12345678',
					status: 'active',
				}),
			).toBe(true)
		})
	})

	describe('when the lookup resolved a same-named different company', () => {
		it('should not confirm when the legal name does not match the target', () => {
			// GIVEN a resolved record for an unrelated firm
			// WHEN checked
			// THEN a look-alike registry hit does not count as reaching the target
			expect(
				isConfirmedRegistryMatch(targets, {
					legalName: 'Global Freight Partners SA',
					status: 'active',
				}),
			).toBe(false)
		})
	})

	describe('when the country has no registry match', () => {
		it('should not confirm on a no_registry result', () => {
			// GIVEN the tool returned {status:'no_registry'} (no company resolved)
			// WHEN checked
			// THEN there is nothing to confirm
			expect(
				isConfirmedRegistryMatch(targets, {
					status: 'no_registry',
					country: 'ES',
				}),
			).toBe(false)
		})
	})

	describe('when there is no target or the result is not a record', () => {
		it('should not confirm without targets, or on a non-object result', () => {
			// GIVEN a discovery run has no entity targets, or a failed/empty result
			// WHEN checked
			// THEN neither can confirm a target
			expect(
				isConfirmedRegistryMatch(null, { legalName: 'ACME LOGISTICS SL' }),
			).toBe(false)
			expect(isConfirmedRegistryMatch(targets, null)).toBe(false)
			expect(isConfirmedRegistryMatch(targets, 'not a record')).toBe(false)
		})
	})
})

describe('classifyEntityMatchPerSource', () => {
	const targets = deriveEntityTargets({
		schemaName: 'company_enrichment_v1',
		query: 'Acme Logistics',
		subjects: [
			{
				table: 'companies',
				name: 'Acme Logistics',
				website: 'https://acme.es',
			},
		],
	})

	describe('when the sources mix the target and a look-alike', () => {
		it('should tag each source on its own', () => {
			// GIVEN one page on the target's own site and one about a same-named other firm
			const verdicts = classifyEntityMatchPerSource(targets!, [
				{
					sourceId: 'a',
					text: 'Welcome to acme.es — Acme Logistics of Barcelona',
				},
				{ sourceId: 'b', text: 'CEVA is a global freight leader' },
			])

			// WHEN classified per source — THEN the target's page is strong, the other absent
			expect(verdicts).toEqual([
				{ sourceId: 'a', match: 'strong' },
				{ sourceId: 'b', match: 'absent' },
			])
		})
	})

	describe('when a page is on the target domain but its body omits the name', () => {
		it('should ground it strongly by host, not text', () => {
			// GIVEN an offices page on the target's own domain whose body is just an
			// address — it never spells "Acme Logistics"
			const verdicts = classifyEntityMatchPerSource(targets!, [
				{
					sourceId: 'offices',
					text: 'Head office: 12 Carrer Gran, 08820 Barcelona',
					host: 'acme.es',
				},
			])

			// WHEN classified — THEN its own host grounds it, so its facts survive
			expect(verdicts).toEqual([{ sourceId: 'offices', match: 'strong' }])
		})
	})
})

describe('groundedSourceIds', () => {
	describe('when some sources are the target and some are not', () => {
		it('should keep the strong and weak ones and drop the absent', () => {
			// GIVEN a mix of per-source verdicts
			// WHEN filtered — THEN only the target's pages remain
			expect(
				groundedSourceIds([
					{ sourceId: 'a', match: 'strong' },
					{ sourceId: 'b', match: 'absent' },
					{ sourceId: 'c', match: 'weak' },
				]),
			).toEqual(['a', 'c'])
		})
	})
})

describe('deriveEntityTargets with an anchor domain', () => {
	describe('when a correction supplies the correct official domain', () => {
		it('should add the anchor host as a strong domain key even when the subject website is missing', () => {
			// GIVEN an anchored subject whose stored website is absent, plus a
			// user-supplied anchor domain
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Acme',
				subjects: [{ table: 'companies', name: 'Acme Widgets' }],
				anchorDomain: 'https://www.acme.com/contact',
			})
			// THEN the anchor host is a strong-match domain key, its label a weak word
			expect(targets?.domains).toContain('acme.com')
			expect(targets?.words).toContain('acme')
		})

		it('should ground a query-only enrichment on the anchor host', () => {
			// GIVEN a query-only enrichment (no subject) with an anchor domain
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'some company',
				subjects: [],
				anchorDomain: 'monzo.com',
			})
			// THEN the host still becomes a domain key
			expect(targets?.domains).toContain('monzo.com')
		})

		it('should ignore an unparseable anchor domain', () => {
			// GIVEN an anchor value that is not a domain
			const withJunk = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Acme',
				subjects: [{ table: 'companies', name: 'Acme Widgets' }],
				anchorDomain: 'not a domain',
			})
			const without = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Acme',
				subjects: [{ table: 'companies', name: 'Acme Widgets' }],
			})
			// THEN it is dropped and the result matches the no-anchor derivation
			expect(withJunk?.domains).toEqual(without?.domains)
		})
	})
})

describe('deriveEntityTargets with a domain in the query', () => {
	describe('when the caller writes the official domain into the query text', () => {
		it('should fold that host into the strong-match domain keys', () => {
			// GIVEN a query-only enrichment whose text carries the company's domain
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Sunset Transportation (sunsettrans.com)',
				subjects: [],
			})
			// THEN a page referencing that host will strong-match the target
			expect(targets?.domains).toContain('sunsettrans.com')
		})
	})
})

describe('parseQueryDomain', () => {
	describe('when the query carries a domain-shaped token', () => {
		it('should pull it out of parentheses, plain text, or an email address', () => {
			// GIVEN queries that mention the company domain in different shapes
			// THEN each yields the bare registrable host
			expect(parseQueryDomain('Sunset Transportation (sunsettrans.com)')).toBe(
				'sunsettrans.com',
			)
			expect(parseQueryDomain('Echo Global Logistics echo.com')).toBe(
				'echo.com',
			)
			expect(parseQueryDomain('reach me at jane@acme.co.uk please')).toBe(
				'acme.co.uk',
			)
			expect(parseQueryDomain('visit https://www.monzo.com/about')).toBe(
				'monzo.com',
			)
		})
	})

	describe('when the query has no real domain', () => {
		it('should return undefined rather than match an abbreviation or decimal', () => {
			// GIVEN text with dotted tokens that are not domains
			// THEN nothing is treated as a domain
			expect(parseQueryDomain('Sunset Transportation, St. Louis MO')).toBe(
				undefined,
			)
			expect(parseQueryDomain('e.g. a freight broker')).toBe(undefined)
			expect(parseQueryDomain('revenue grew 3.5 last year')).toBe(undefined)
			expect(parseQueryDomain('just a plain company name')).toBe(undefined)
		})
	})
})

describe('deriveAnchorHost', () => {
	describe('when several domain signals are present', () => {
		it('should prefer the corrected anchor domain over the subject website', () => {
			// GIVEN a subject website and a later human-corrected anchor domain
			const host = deriveAnchorHost({
				schemaName: 'company_enrichment_v1',
				query: 'Acme (acme-query.com)',
				subjects: [
					{ table: 'companies', name: 'Acme', website: 'https://sub.com' },
				],
				anchorDomain: 'https://www.corrected.com/x',
			})
			// THEN the corrected domain wins
			expect(host).toBe('corrected.com')
		})

		it('should prefer the subject website over a domain in the query', () => {
			// GIVEN a subject website and a domain in the query, but no anchor domain
			const host = deriveAnchorHost({
				schemaName: 'company_enrichment_v1',
				query: 'Acme (acme-query.com)',
				subjects: [
					{ table: 'companies', name: 'Acme', website: 'https://sub.com' },
				],
			})
			// THEN the subject's own site wins
			expect(host).toBe('sub.com')
		})
	})

	describe('when only the query carries a domain', () => {
		it('should anchor an entity-grounded run on the query domain', () => {
			// GIVEN a query-only enrichment with the domain in the text
			// THEN the query domain is the anchor
			expect(
				deriveAnchorHost({
					schemaName: 'company_enrichment_v1',
					query: 'Echo Global Logistics echo.com',
					subjects: [],
				}),
			).toBe('echo.com')
		})

		it('should not read the query for a scan run with no subject', () => {
			// GIVEN a scan schema (reports third parties) with a domain in the query
			// THEN there is no single official site to anchor on
			expect(
				deriveAnchorHost({
					schemaName: 'prospect_scan_v1',
					query: 'freight brokers near acme.com',
					subjects: [],
				}),
			).toBe(undefined)
		})
	})

	describe('when no domain signal is present', () => {
		it('should return undefined', () => {
			// GIVEN a plain company-name query with no subject or anchor
			expect(
				deriveAnchorHost({
					schemaName: 'company_enrichment_v1',
					query: 'Sunset Transportation, St. Louis MO',
					subjects: [],
				}),
			).toBe(undefined)
		})
	})
})

describe('domainHost', () => {
	describe('when given a full URL', () => {
		it('should reduce it to the bare registrable host', () => {
			// GIVEN a URL with scheme, www, path, and mixed case
			expect(domainHost('https://www.Acme.co.uk/about')).toBe('acme.co.uk')
			expect(domainHost('monzo.com')).toBe('monzo.com')
		})
	})

	describe('when given something that is not a host', () => {
		it('should return undefined', () => {
			// GIVEN text with no dot, or too short to be a host
			expect(domainHost('localhost')).toBeUndefined()
			expect(domainHost('a.b')).toBeUndefined()
		})
	})
})

describe('labelSpellsOneOf', () => {
	describe('when the label is one of the names', () => {
		it('should accept it whole and with the legal form after it', () => {
			// GIVEN a workshop's domain written both ways
			// WHEN read against the name — THEN a form on the end is the company
			// still writing itself, so both spell it
			expect(labelSpellsOneOf('fusteriamiquel', ['fusteriamiquel'])).toBe(true)
			expect(labelSpellsOneOf('fusteriamiquelsl', ['fusteriamiquel'])).toBe(
				true,
			)
		})

		it('should read any one of the names offered', () => {
			// GIVEN several ways the company could have registered
			// WHEN read — THEN one of them spelling the label is enough
			expect(labelSpellsOneOf('acme', ['acmelogistics', 'acme'])).toBe(true)
		})
	})

	describe('when the label carries more than the name', () => {
		it('should refuse anything appended that is not a legal form', () => {
			// GIVEN a review site named after the company
			// WHEN read — THEN whoever registered it writes ABOUT the company
			expect(labelSpellsOneOf('acmelogisticsreviews', ['acmelogistics'])).toBe(
				false,
			)
		})

		it('should refuse a name the label merely contains', () => {
			// GIVEN a domain with a word in front of the name
			// WHEN read — THEN the name has to BE the label, not sit inside it
			expect(labelSpellsOneOf('grupoacme', ['acme'])).toBe(false)
		})
	})

	describe('when there is no name to read', () => {
		it('should refuse an empty list', () => {
			// GIVEN a caller whose names came back empty
			// WHEN read — THEN no, rather than yes out of having nothing to compare
			expect(labelSpellsOneOf('acme', [])).toBe(false)
		})

		it('should refuse an empty name among real ones', () => {
			// GIVEN a name with nothing in it, which every label starts with
			// WHEN read
			// THEN it spells nothing. Left in, it would hand every domain a yes — and
			// a label that happens to be a legal form ("sl") would get one twice over
			expect(labelSpellsOneOf('acme', [''])).toBe(false)
			expect(labelSpellsOneOf('sl', ['', 'acme'])).toBe(false)
		})
	})
})

describe('hostLabel', () => {
	describe('when given a host with a label to read', () => {
		it('should return the label the domain is registered under', () => {
			// GIVEN hosts with a subdomain, a plain domain, and a country second level
			// WHEN read — THEN what is left is the label somebody registered
			expect(hostLabel('annuaire.tecsol.fr')).toBe('tecsol')
			expect(hostLabel('acme.com')).toBe('acme')
			expect(hostLabel('shop.acme.co.uk')).toBe('acme')
		})

		it('should keep a label too short to stand on its own', () => {
			// GIVEN the large carriers' three-letter domains
			// WHEN read
			// THEN they come back whole. Whether three letters mean anything depends
			// on the question asked of them, so the floor belongs to the caller
			expect(hostLabel('xpo.com')).toBe('xpo')
			expect(hostLabel('dsv.com')).toBe('dsv')
		})
	})

	describe('when given something with no label', () => {
		it('should return an empty string', () => {
			// GIVEN a bare word, which is all the top level with nothing under it
			// WHEN read — THEN nothing, rather than the top level read as a name
			expect(hostLabel('localhost')).toBe('')
			expect(hostLabel('')).toBe('')
		})
	})
})

describe('registrableDomain', () => {
	describe('when given a host under an ordinary top level', () => {
		it('should keep the registered label and its ending', () => {
			// GIVEN a plain domain
			// WHEN read
			// THEN the ending stays, unlike `hostLabel` — "acme.es" and "acme.de"
			// spell one label and belong to two different firms
			expect(registrableDomain('acme.es')).toBe('acme.es')
			expect(registrableDomain('xpo.com')).toBe('xpo.com')
		})

		it('should fold a subdomain onto the domain it sits under', () => {
			// GIVEN two addresses on one site
			// WHEN read — THEN both name the same website
			expect(registrableDomain('blog.acme.es')).toBe('acme.es')
			expect(registrableDomain('a.b.c.acme.es')).toBe('acme.es')
		})

		it('should fold a sub-brand onto its parent site', () => {
			// GIVEN a listing that lives on a newspaper's domain
			// WHEN read
			// THEN they are one website for counting sources — the fold that the
			// directory verdict must never make, because it would label the paper
			expect(registrableDomain('empresite.eleconomista.es')).toBe(
				'eleconomista.es',
			)
		})
	})

	describe('when given a host under a second-level ending', () => {
		it('should keep both parts of the ending', () => {
			// GIVEN a country that registers under a second level
			// WHEN read — THEN "co.uk" is the ending, not the registered domain
			expect(registrableDomain('acme.co.uk')).toBe('acme.co.uk')
			expect(registrableDomain('shop.acme.co.uk')).toBe('acme.co.uk')
		})

		it('should fold one label too few under an ending it does not name', () => {
			// GIVEN a second level outside the short set this knows
			// WHEN read
			// THEN it folds too far, merging separate firms into one website. That
			// direction only ever turns two sources into one, which withholds a
			// confirmation and can never manufacture one
			expect(registrableDomain('acme.plc.uk')).toBe('plc.uk')
		})
	})

	describe('when given something with no registered label', () => {
		it('should hand back what there is', () => {
			// GIVEN a bare word or nothing at all — neither reaches this from a real
			// address, since an address needs a dot to be one
			// WHEN read — THEN nothing is invented
			expect(registrableDomain('localhost')).toBe('localhost')
			expect(registrableDomain('')).toBe('')
		})
	})
})

describe('queryPlaces', () => {
	describe('when the query carries a "Name, City" tail', () => {
		it('should keep the distinctive place words after the first comma', () => {
			// GIVEN the convention "Company Name, City" in a free-text query
			// WHEN the places are parsed
			// THEN only the location tail is read, not the company name
			expect(queryPlaces('Deliveroo, London')).toEqual(['london'])
		})

		it('should drop short tokens and generic administrative words', () => {
			// GIVEN a location with a short state code and an admin word
			// WHEN parsed
			// THEN "st"/"mo" (too short) and "city" (generic) are dropped
			expect(queryPlaces('Sunset Transportation, St. Louis MO')).toEqual([
				'louis',
			])
			expect(queryPlaces('Acme, Kansas City')).toEqual(['kansas'])
		})
	})

	describe('when a location hint is supplied', () => {
		it('should fold the hint in alongside the query tail and dedupe', () => {
			// GIVEN both a query tail and a separate location hint
			// WHEN parsed
			// THEN both contribute place words, with duplicates collapsed
			expect(queryPlaces('Acme, Barcelona', 'Barcelona, Spain')).toEqual([
				'barcelona',
				'spain',
			])
		})
	})

	describe('when no location is present', () => {
		it('should return empty for a bare name so the city check fails open', () => {
			// GIVEN a plain company name with no comma and no hint
			// WHEN parsed
			// THEN there are no place words to require
			expect(queryPlaces('Dyson')).toEqual([])
		})
	})
})

describe('placesCorroborate', () => {
	const deliveroo: EntityTargets = {
		cores: ['deliveroo'],
		words: ['deliveroo'],
		domains: [],
		places: ['london'],
	}

	describe('when the evidence names the queried place', () => {
		it('should return true regardless of case and punctuation', () => {
			// GIVEN a corpus that mentions the queried city
			// WHEN checked
			// THEN the place corroborates (folding matches "London." to "london")
			expect(placesCorroborate(deliveroo, 'Head office in London.')).toBe(true)
		})
	})

	describe('when the evidence names a different place', () => {
		it('should return false', () => {
			// GIVEN a corpus that names only another city
			expect(placesCorroborate(deliveroo, 'Now operating from New York')).toBe(
				false,
			)
		})
	})

	describe('when no place was queried', () => {
		it('should return false', () => {
			// GIVEN targets with no place keys
			// THEN there is nothing to corroborate
			expect(placesCorroborate({ ...deliveroo, places: [] }, 'London')).toBe(
				false,
			)
		})
	})
})

describe('reachedOwnSite', () => {
	const targets: EntityTargets = {
		cores: ['deliveroo'],
		words: ['deliveroo'],
		domains: ['deliveroo.com'],
		places: ['london'],
	}

	describe('when a fetched page is the company site', () => {
		it('should return true for a page whose host is a target domain', () => {
			// GIVEN a page fetched from the target's own domain
			expect(reachedOwnSite(targets, [{ host: 'deliveroo.com' }])).toBe(true)
		})

		it('should return true for a page whose host label matches the name', () => {
			// GIVEN a page on a country domain the caller never supplied
			// THEN the "deliveroo" label still identifies the company's own site
			expect(reachedOwnSite(targets, [{ host: 'deliveroo.co.uk' }])).toBe(true)
		})
	})

	describe('when the host is the trade the company is named after', () => {
		it('should not read a trade domain as the company own site', () => {
			// GIVEN a company whose name opens with its trade, and the trade's own
			// domain — a company Batuda has never heard of owns that address
			const named: EntityTargets = {
				cores: ['transportesgarcia'],
				words: ['garcia'],
				domains: [],
				places: [],
			}

			// WHEN the trade's domain is offered as a page the run reached
			// THEN it is not the company's site. The name contains the word, not the
			// other way round, and reading it either way handed every company named
			// after its trade the trade's own address — which the mailbox harvester
			// then read a stranger's email off
			expect(reachedOwnSite(named, [{ host: 'transportes.com' }])).toBe(false)
			expect(isOwnSiteHost(named, 'transportes.com')).toBe(false)
		})

		it('should still recognise a host that carries the whole name', () => {
			// GIVEN the same company and a domain that spells its full name
			const named: EntityTargets = {
				cores: ['transportesgarcia'],
				words: ['garcia'],
				domains: [],
				places: [],
			}

			// WHEN checked — THEN the company's own site is unaffected
			expect(reachedOwnSite(named, [{ host: 'transportesgarcia.es' }])).toBe(
				true,
			)
		})
	})

	describe('when the fetched pages are all third-party', () => {
		it('should return false for an unrelated host', () => {
			// GIVEN only a page on a different company's domain
			expect(reachedOwnSite(targets, [{ host: 'doordash.com' }])).toBe(false)
		})

		it('should return false for a page with no host', () => {
			// GIVEN a corpus entry carrying no host (e.g. a tool result)
			expect(reachedOwnSite(targets, [{ host: undefined }])).toBe(false)
		})
	})
})

describe('isOwnSiteHost', () => {
	// "Transportes García" — the trade first, the family name last, which is how
	// most small firms in Spain and Catalonia are named.
	const garcia: EntityTargets = {
		cores: ['transportesgarcia'],
		words: ['garcia'],
		domains: [],
		places: ['barcelona'],
	}

	describe('when the domain is the company site', () => {
		it('should accept a domain the caller supplied', () => {
			// GIVEN the host the caller handed over
			const anchored: EntityTargets = { ...garcia, domains: ['tg.example'] }
			expect(isOwnSiteHost(anchored, 'tg.example')).toBe(true)
		})

		it('should accept the distinctive part of the name on its own', () => {
			// GIVEN the family name, which is what such a firm actually registers
			// THEN it is the company's site even though the name says more
			expect(isOwnSiteHost(garcia, 'garcia.es')).toBe(true)
			expect(isOwnSiteHost(garcia, 'garcia.cat')).toBe(true)
		})

		it('should accept the whole name spelled out', () => {
			expect(isOwnSiteHost(garcia, 'transportesgarcia.com')).toBe(true)
		})

		it('should accept the whole name with the legal form tacked on', () => {
			// GIVEN a domain registered as the firm signs itself
			expect(isOwnSiteHost(garcia, 'transportesgarciasl.es')).toBe(true)
		})
	})

	describe('when the domain only carries the trade the company is in', () => {
		it('should reject it — an industry word identifies nobody', () => {
			// GIVEN a domain that is the generic half of the name. Accepting this
			// would send the run off to read a stranger's site as the company's.
			expect(isOwnSiteHost(garcia, 'transportes.com')).toBe(false)
			expect(isOwnSiteHost(garcia, 'transporte.es')).toBe(false)
		})
	})

	describe('when the domain is somebody writing about the company', () => {
		it('should reject a directory or review site carrying the name', () => {
			const acme: EntityTargets = {
				cores: ['acmelogistics'],
				words: ['acme'],
				domains: [],
				places: [],
			}
			// GIVEN hosts that spell the company out and then add their own purpose
			expect(isOwnSiteHost(acme, 'acmelogisticsreviews.com')).toBe(false)
			expect(isOwnSiteHost(acme, 'acme-directory.com')).toBe(false)
		})

		it('should reject a well-known aggregator', () => {
			expect(isOwnSiteHost(garcia, 'crunchbase.com')).toBe(false)
			expect(isOwnSiteHost(garcia, 'zoominfo.com')).toBe(false)
		})

		it('should reject an unrelated host', () => {
			expect(isOwnSiteHost(garcia, 'doordash.com')).toBe(false)
		})
	})

	describe('when the name gives nothing to match on', () => {
		it('should reject rather than guess', () => {
			// GIVEN a company whose name folds to under four characters, and one
			// whose every word is the trade it works in
			const tiny: EntityTargets = {
				cores: ['abc'],
				words: [],
				domains: [],
				places: [],
			}
			const generic: EntityTargets = {
				cores: ['transporteslogistica'],
				words: [],
				domains: [],
				places: [],
			}

			// THEN no host is accepted on the strength of it
			expect(isOwnSiteHost(tiny, 'a-b-c.com')).toBe(false)
			expect(isOwnSiteHost(tiny, 'abcdirectory.com')).toBe(false)
			expect(isOwnSiteHost(generic, 'transportes.com')).toBe(false)
		})
	})
})

describe('cityGate', () => {
	const targets: EntityTargets = {
		cores: ['deliveroo'],
		words: ['deliveroo'],
		domains: [],
		places: ['london'],
	}

	describe('when a name-only match names no reachable site in the queried city', () => {
		it('should downgrade so the run fails closed', () => {
			// GIVEN the name appears on third-party pages, no own site was reached,
			// no register confirmed it, and the queried city is absent
			// WHEN the city gate runs
			// THEN it downgrades — a lookalike or stale mention, not the target
			expect(
				cityGate({
					targets,
					corpus: 'Deliveroo was acquired; operations moved to New York.',
					pages: [{ host: 'doordash.com' }],
					registryConfirmed: false,
				}),
			).toBe('downgrade')
		})
	})

	describe('when the queried city is corroborated', () => {
		it('should keep the match', () => {
			// GIVEN the evidence names both the company and the queried city
			expect(
				cityGate({
					targets,
					corpus: 'Deliveroo, headquartered in London.',
					pages: [{ host: 'news.example.com' }],
					registryConfirmed: false,
				}),
			).toBe('keep')
		})
	})

	describe('when the run reached the company own site', () => {
		it('should keep even if the city is not spelled out', () => {
			// GIVEN a page on the company's own domain (the homepage rarely names its city)
			expect(
				cityGate({
					targets,
					corpus: 'Deliveroo — order food you love.',
					pages: [{ host: 'deliveroo.co.uk' }],
					registryConfirmed: false,
				}),
			).toBe('keep')
		})
	})

	describe('when a register confirmed the company', () => {
		it('should keep regardless of the city', () => {
			// GIVEN a registry lookup confirmed the legal entity
			expect(
				cityGate({
					targets,
					corpus: 'Deliveroo mentioned in a directory.',
					pages: [{ host: 'directory.example.com' }],
					registryConfirmed: true,
				}),
			).toBe('keep')
		})
	})

	describe('when no city was queried', () => {
		it('should keep so a location-less query is never tightened', () => {
			// GIVEN targets with no place keys (the caller gave only a name)
			expect(
				cityGate({
					targets: { ...targets, places: [] },
					corpus: 'Deliveroo somewhere.',
					pages: [{ host: 'doordash.com' }],
					registryConfirmed: false,
				}),
			).toBe('keep')
		})
	})
})

describe('nameSpellings', () => {
	describe('when the name carries no geminate mark', () => {
		it('should read the name one way only', () => {
			// GIVEN two different companies whose names differ by a doubled l, and
			// neither of which marks a geminate
			// WHEN each is read
			// THEN each keeps its own single spelling, so nothing brings the two
			// together. Reading every "ll" as a possible geminate would make one
			// company of them, and both names are ordinary here
			expect(nameSpellings('Villa Nova SL')).toEqual(['Villa Nova SL'])
			expect(nameSpellings('Vila Nova SL')).toEqual(['Vila Nova SL'])
			expect(spellingsWithoutForms('Villa Nova SL')).toEqual(['villanova'])
			expect(spellingsWithoutForms('Vila Nova SL')).toEqual(['vilanova'])
		})
	})

	describe('when the name carries a geminate mark', () => {
		it('should read it both ways, the name as written first', () => {
			// GIVEN a Catalan name written with an interpunct
			// WHEN it is read
			// THEN both ways an address may write it come back, and the name as
			// written leads — that one is the company's identity
			expect(spellingsWithoutForms('Instal·lacions Vives SL')).toEqual([
				'installacionsvives',
				'instalacionsvives',
			])
			expect(spellingsWithoutForms('Col·legi Oficial')).toEqual([
				'collegioficial',
				'colegioficial',
			])
		})

		it('should collapse only the marked l, leaving every other doubled l alone', () => {
			// GIVEN a name holding both a marked geminate and an ordinary doubled l
			// WHEN it is read
			// THEN only the marked pair is written out two ways: "Vallès" keeps its
			// two l's in both readings, so the second reading can never reach a name
			// that merely happens to be spelled with one
			expect(spellingsWithoutForms('Col·legi Vallès SL')).toEqual([
				'collegivalles',
				'colegivalles',
			])
		})

		it('should read the mark however it was typed, in either case', () => {
			// GIVEN the mark written as each character a keyboard, a word processor
			// or a paste leaves behind, and a name in capitals as a register writes it
			// WHEN each is read
			// THEN all of them come to the same two spellings
			for (const mark of ['·', '·', '•', '‧', '∙', '⋅']) {
				expect(spellingsWithoutForms(`Instal${mark}lacions`)).toEqual([
					'installacions',
					'instalacions',
				])
			}
			expect(spellingsWithoutForms('INSTAL·LACIONS SL')).toEqual([
				'installacions',
				'instalacions',
			])
		})

		it('should read several marks all the same way rather than in every mix', () => {
			// GIVEN a name carrying two marks
			// WHEN it is read
			// THEN two spellings come back and not four: an address is slugged by one
			// convention, not a different one per word
			expect(spellingsWithoutForms('Col·legi Instal·ladors')).toEqual([
				'collegiinstalladors',
				'colegiinstaladors',
			])
		})

		it('should leave a mark that is not between two l s alone', () => {
			// GIVEN a name using the same character as a separator rather than as a
			// geminate mark
			// WHEN it is read
			// THEN nothing is written out twice, because there is no geminate there
			expect(nameSpellings('Serveis · Manteniment')).toEqual([
				'Serveis · Manteniment',
			])
		})

		it('should read the mark typed as an ASCII period', () => {
			// GIVEN the geminate typed with a period, which is how a database that
			// could not write the interpunct spells it
			// WHEN it is read
			// THEN both spellings come back, as for the interpunct. The reading takes
			// the name before a legal form's dots come out, which is the only order
			// that leaves a period there to be recognised
			expect(spellingsWithoutForms('Instal.lacions Vives')).toEqual([
				'installacionsvives',
				'instalacionsvives',
			])
		})

		it('should not mistake a legal form written in dots for the mark', () => {
			// GIVEN names whose dots belong to a legal form rather than to a geminate
			// WHEN each is read
			// THEN none of them is read twice: the two l's have to touch the mark, so
			// "S.L." holds no l-dot-l and a space sits at the join in "S.L. Lopez"
			expect(spellingsWithoutForms('Muñoz S.L.')).toEqual(['munoz'])
			expect(spellingsWithoutForms('Comercial S.L. Lopez')).toEqual([
				'comerciallopez',
			])
			// Both halves of the Mexican form go, wherever they sit, leaving the word
			// that joined them — this reading takes forms out rather than reading one
			// off the end, which is `coreSpellings`' job
			expect(spellingsWithoutForms('Grupo Ejemplo S.A. de C.V.')).toEqual([
				'grupoejemplode',
			])
			expect(coreSpellings('Grupo Ejemplo S.A. de C.V.')).toEqual([
				'grupoejemplo',
			])
		})
	})

	describe('when a legal form is written in dots', () => {
		it('should read the name the same way for every caller', () => {
			// GIVEN a name whose legal form is written in dots, which is the ordinary
			// Spanish spelling
			// WHEN the reading is asked for it
			// THEN the form is gone. Putting the dots back together belongs to the
			// reading rather than to each caller: while one caller did it and the
			// other did not, the same name was "munoz" to the directory watch and
			// "munozsl" to the website guard, and the guard looking for the longer one
			// could not find the company on its own munoz.es
			expect(spellingsWithoutForms('Muñoz S.L.')).toEqual(['munoz'])
			expect(coreSpellings('Muñoz S.L.')).toEqual(['munoz'])
		})

		it('should give a run the same keys as the name written without dots', () => {
			// GIVEN one company written both ways a Spanish list writes it
			const dotted = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Muñoz S.L.',
				subjects: [{ table: 'companies', name: 'Muñoz S.L.' }],
			})
			const plain = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Muñoz SL',
				subjects: [{ table: 'companies', name: 'Muñoz SL' }],
			})

			// WHEN each is turned into match keys
			// THEN they are the same keys. Two rows of one list spelling the form
			// differently is the ordinary case, and the dotted one used to carry the
			// form into its key and land the company under a name of its own
			expect(dotted?.cores).toEqual(plain?.cores)
			expect(dotted?.cores).toEqual(['munoz'])
		})

		it('should keep a Catalan name readable both ways through the dots', () => {
			// GIVEN a Catalan name carrying both a dotted geminate and a dotted form
			// WHEN it is read
			// THEN the geminate is read first and the form's dots come out after, so
			// neither spelling is lost to the other rule
			expect(spellingsWithoutForms('Instal.lacions Vives S.L.')).toEqual([
				'installacionsvives',
				'instalacionsvives',
			])
		})
	})

	describe('when the name has nothing left after its legal form', () => {
		it('should offer no key at all', () => {
			// GIVEN a name that is only a legal form, and an empty one
			// WHEN read
			// THEN there is no key to look for, so a caller cannot be handed one that
			// every address would match
			expect(spellingsWithoutForms('SL')).toEqual([])
			expect(spellingsWithoutForms('')).toEqual([])
			expect(nameSpellings('')).toEqual([''])
		})
	})
})

describe('coreSpellings', () => {
	describe('when a geminate name closes with a legal form', () => {
		it('should read both spellings with the form off the end', () => {
			// GIVEN a Catalan name with a trailing legal form
			// WHEN its strong-match keys are read
			// THEN both spellings come back without the form
			expect(coreSpellings('Instal·lacions Vives SL')).toEqual([
				'installacionsvives',
				'instalacionsvives',
			])
		})
	})

	describe('when the name carries no mark', () => {
		it('should read the one key it always did', () => {
			// GIVEN an ordinary name
			// WHEN its keys are read
			// THEN there is exactly one, unchanged
			expect(coreSpellings('Acme Logistics Ltd')).toEqual(['acmelogistics'])
		})
	})
})

describe('distinctiveWords', () => {
	describe('when a word of the name carries a geminate mark', () => {
		it('should offer that word in both spellings', () => {
			// GIVEN a name whose distinctive word is geminated
			// WHEN its distinctive words are read
			// THEN both spellings are there, so an address writing either is
			// recognised, and a word carrying no mark still appears once
			expect(distinctiveWords('Instal·lacions Vives SL')).toEqual([
				'installacions',
				'vives',
				'instalacions',
			])
		})
	})

	describe('when the name is built only from trade and legal words', () => {
		it('should offer nothing to match on', () => {
			// GIVEN a name that says a kind of company and a trade and no more
			// WHEN its distinctive words are read
			// THEN there are none: a generic word identifies nobody, and matching on
			// one is the expensive mistake
			expect(distinctiveWords('Grupo Express SL')).toEqual([])
		})
	})
})

describe('namesNobodyInParticular', () => {
	describe('when every word of the name names a trade or a legal form', () => {
		it('should say so', () => {
			// GIVEN names built only from those words
			// WHEN each is asked
			// THEN each says it names nobody in particular
			expect(namesNobodyInParticular('Grupo Express SL')).toBe(true)
			expect(namesNobodyInParticular('Transportes Logistica SL')).toBe(true)
			expect(namesNobodyInParticular('')).toBe(true)
		})
	})

	describe('when one word of the name is the company own', () => {
		it('should say the name identifies somebody', () => {
			// GIVEN names carrying a word that stands for this company rather than
			// for its trade — including one whose only such word is geminated, and
			// one whose word merely resembles a trade word without being one
			// WHEN each is asked
			// THEN each identifies somebody
			expect(namesNobodyInParticular('Fusteria Miquel SL')).toBe(false)
			expect(namesNobodyInParticular('Instal·lacions Vives SL')).toBe(false)
			expect(namesNobodyInParticular('Servicios Globales SL')).toBe(false)
		})
	})
})

describe('deriveEntityTargets', () => {
	describe('when the subject name carries a geminate mark', () => {
		it('should match evidence that spells the name either way', () => {
			// GIVEN a run anchored on a Catalan company
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Instal·lacions Vives',
				subjects: [{ table: 'companies', name: 'Instal·lacions Vives SL' }],
			}) as EntityTargets

			// WHEN evidence spells the name with one l, and when it spells it with two
			// THEN both land the run on its target, rather than only the spelling the
			// name happened to be written in
			expect(classifyEntityMatch(targets, 'Instalacions Vives, Girona.')).toBe(
				'strong',
			)
			expect(classifyEntityMatch(targets, 'Installacions Vives, Girona.')).toBe(
				'strong',
			)
		})

		it('should still take the whole name to land on the company', () => {
			// GIVEN the same run
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Instal·lacions Vives',
				subjects: [{ table: 'companies', name: 'Instal·lacions Vives SL' }],
			}) as EntityTargets

			// WHEN the evidence is about a different company in the same trade
			// THEN it never reads as the target. The second spelling writes out one
			// marked pair of l's and turns no other part of a name into a wildcard,
			// so the strong bar — which is what lets a run act on its findings —
			// still takes the whole name
			expect(
				classifyEntityMatch(targets, 'Instalacions Puig, Lleida.'),
			).not.toBe('strong')
			expect(classifyEntityMatch(targets, 'Vila Nova SL, Girona.')).toBe(
				'absent',
			)
		})

		it('should reach the same verdict whichever way the trade word is spelled', () => {
			// GIVEN the same run, and a page about a different company whose trade is
			// written the three ways Catalan writes it
			const targets = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Instal·lacions Vives',
				subjects: [{ table: 'companies', name: 'Instal·lacions Vives SL' }],
			}) as EntityTargets

			// WHEN each is classified
			// THEN all three are weak — the run is told it never clearly landed, and
			// its findings wait for somebody to read them.
			//
			// This is the cost of reading a name both ways, and it is worth stating
			// plainly: a page about a stranger in the same trade is weak whichever
			// way that trade is spelled, because "instal·lacions" counts as a
			// distinctive word — it is not among the generic ones. Whether it belongs
			// there is a separate decision about which words name a trade, not about
			// how a name is folded
			for (const corpus of [
				'Instalacions Puig, Lleida.',
				'Installacions Puig, Lleida.',
				'Instal·lacions Puig, Lleida.',
			]) {
				expect(classifyEntityMatch(targets, corpus)).toBe('weak')
			}
		})
	})
})
