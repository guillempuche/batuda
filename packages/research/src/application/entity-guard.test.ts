import { describe, expect, it } from 'vitest'

import {
	cityGate,
	classifyEntityMatch,
	classifyEntityMatchPerSource,
	collapse,
	coreSpellings,
	deriveAnchorHost,
	deriveEntityTargets,
	distinctiveWords,
	domainHost,
	type EntityTargets,
	foldTokens,
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
import { EQUIVALENT_LETTERS } from './letter-equivalences.generated'
import { ownSiteVerdict } from './own-site'
import { runWordsOf } from './run-words'

// A run that named no trades, which is a request about one company on file.
const noRunWords = runWordsOf([])

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
					deriveEntityTargets({ schemaName, query: 'anything', subjects: [] })
						.targets,
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
			}).targets

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
			}).targets

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
			}).targets

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
			}).targets
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
			}).targets
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
			}).targets
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
			}).targets
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
				}).targets,
			).toBeNull()
		})

		it('should say the subject went unread rather than pass as ungated', () => {
			// GIVEN the same unidentifiable subject
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: '',
				subjects: [{ table: 'companies' }],
			})
			// THEN it is told apart from a run that is about nobody in particular:
			// there is a company here, and nothing came of trying to read it
			expect(reading.subjectUnreadable).toBe(true)
		})
	})
})

describe('deriveEntityTargets on a name the fold cannot read', () => {
	// Each of these folds to nothing, so no key comes out and every check that
	// would hold a page against the company has nothing to hold it against.
	const unreadable = [
		['Greek', 'Ηλεκτρολογικά Παπαδόπουλος'],
		['Cyrillic', 'Строймонтаж Иванов'],
		['Arabic', 'شركة الخليج للمقاولات'],
		['CJK', '株式会社山田電気'],
		['Korean', '삼성전자'],
		['Devanagari', 'शर्मा इलेक्ट्रिकल्स'],
	] as const

	describe('when an entity-grounded run names its subject in another alphabet', () => {
		for (const [alphabet, name] of unreadable) {
			it(`should report the ${alphabet} subject as unread, with no keys`, () => {
				// GIVEN an enrichment run for a company written in this alphabet
				const reading = deriveEntityTargets({
					schemaName: 'company_enrichment_v1',
					query: name,
					subjects: [{ table: 'companies', name }],
				})
				// THEN no key came out — the fold holds plain letters for none of it
				expect(reading.targets).toBeNull()
				// AND the run says so, instead of reading as one with nothing to check
				expect(reading.subjectUnreadable).toBe(true)
			})
		}

		it('should say the same for a contact hunt, which is about one company too', () => {
			// GIVEN a contact_discovery_v1 run — the other schema whose whole job is
			// its own named subject
			const reading = deriveEntityTargets({
				schemaName: 'contact_discovery_v1',
				query: '株式会社山田電気',
				subjects: [],
			})
			// THEN the subject went unread there as well
			expect(reading.targets).toBeNull()
			expect(reading.subjectUnreadable).toBe(true)
		})

		it('should say the same for a scan anchored to such a company', () => {
			// GIVEN a scan pinned to a subject whose name is written in Cyrillic —
			// anchored, so it is held to that subject like an enrichment is
			const reading = deriveEntityTargets({
				schemaName: 'prospect_scan_v1',
				query: 'competitors',
				subjects: [{ table: 'companies', name: 'Строймонтаж Иванов' }],
			})
			// THEN the anchor went unread, and the run is not mistaken for an open
			// scan that was pinned to nobody
			expect(reading.targets).toBeNull()
			expect(reading.subjectUnreadable).toBe(true)
		})
	})

	describe('when a Latin name is too short to stand for a company', () => {
		it('should report it unread, since no key came out of it either', () => {
			// GIVEN a subject whose whole name is two letters — too short to be
			// distinctive, so it is refused the same as an unreadable one
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'AB',
				subjects: [{ table: 'companies', name: 'AB' }],
			})
			// THEN the same hole is reported the same way: there is a company here
			// and no check can be run on it
			expect(reading.targets).toBeNull()
			expect(reading.subjectUnreadable).toBe(true)
		})
	})

	describe('when the run is about nobody in particular', () => {
		it('should report no subject to read rather than an unread one', () => {
			// GIVEN a scan or a freeform brief with no anchored subject — the one
			// case where the checks genuinely have nothing to check
			for (const schemaName of [
				'prospect_scan_v1',
				'competitor_scan_v1',
				'freeform',
			]) {
				const reading = deriveEntityTargets({
					schemaName,
					query: 'anything',
					subjects: [],
				})
				// THEN skipping costs nothing, and nothing is claimed to have gone
				// unread
				expect(reading.targets).toBeNull()
				expect(reading.subjectUnreadable).toBe(false)
			}
		})
	})

	describe('when a name in another alphabet comes with something else to check', () => {
		it('should read the subject through its own website', () => {
			// GIVEN a Japanese company whose row carries its website
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: '株式会社山田電気',
				subjects: [
					{
						table: 'companies',
						name: '株式会社山田電気',
						website: 'https://yamada-denki.co.jp',
					},
				],
			})
			// THEN the host is a key of its own, so the checks have something to run
			// on and nothing went unread
			expect(reading.targets?.domains).toContain('yamada-denki.co.jp')
			expect(reading.subjectUnreadable).toBe(false)
		})

		it('should read the subject through a corrected domain', () => {
			// GIVEN a re-run that carries the human-supplied official domain
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Строймонтаж Иванов',
				subjects: [],
				anchorDomain: 'stroymontazh.ru',
			})
			// THEN that domain is the key, and the subject is not reported unread
			expect(reading.targets?.domains).toContain('stroymontazh.ru')
			expect(reading.subjectUnreadable).toBe(false)
		})

		it('should read a name that is only partly in another alphabet', () => {
			// GIVEN a name whose Latin half spells the company
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: '株式会社 Yamada Denki',
				subjects: [{ table: 'companies', name: '株式会社 Yamada Denki' }],
			})
			// THEN a key comes out of the half that reads, so nothing is reported
			// unread — a subject counts as unread only when no key at all comes out,
			// not when part of the name is dropped
			expect(reading.targets?.cores).toContain('yamadadenki')
			expect(reading.subjectUnreadable).toBe(false)
		})
	})

	describe('when the name reads but names nobody in particular', () => {
		it('should not report it unread, since a key did come out', () => {
			// GIVEN a company called nothing but its trade and its legal form
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Grupo Express SL',
				subjects: [{ table: 'companies', name: 'Grupo Express SL' }],
			})
			// THEN it is a different shortfall from this one — the checks do run,
			// on a key that identifies the trade rather than the firm
			expect(reading.targets).not.toBeNull()
			expect(reading.subjectUnreadable).toBe(false)
		})
	})

	describe('when the name reads normally', () => {
		it('should hand back its keys and report nothing unread', () => {
			// GIVEN a subject named in plain letters, the control for the cases above
			const reading = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Fusteria Miquel',
				subjects: [{ table: 'companies', name: 'Fusteria Miquel' }],
			})
			// THEN the name reads and its key comes out, so there is nothing to say
			expect(reading.targets?.cores).toContain('fusteriamiquel')
			expect(reading.subjectUnreadable).toBe(false)
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
			}).targets
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
			}).targets
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
	}).targets

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
	}).targets

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
			}).targets
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
			}).targets
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
			}).targets
			const without = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Acme',
				subjects: [{ table: 'companies', name: 'Acme Widgets' }],
			}).targets
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
			}).targets
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

	describe('when the label was registered with an accent', () => {
		it('should hand back the name its owner registered', () => {
			// GIVEN domains whose names hold an accent, which a web address cannot
			// carry — so they travel in a code opening "xn--"
			// WHEN each is read
			// THEN the name comes back rather than the code, which folds to letters
			// spelling nothing any company is called
			expect(hostLabel('xn--construccionsgarca-xyb.cat')).toBe(
				'construccionsgarcía',
			)
			expect(hostLabel('xn--nergie-solaire-9jb.fr')).toBe('énergie-solaire')
			expect(hostLabel('www.xn--nergie-solaire-9jb.fr')).toBe('énergie-solaire')
		})

		it('should keep a code it cannot make sense of', () => {
			// GIVEN a label wearing that opening over something that is not one
			// WHEN read
			// THEN the code itself comes back. A reader hands back nothing for a code
			// it cannot read, and an empty label would throw away the only text there
			// was
			expect(hostLabel('xn--acme-9ta.com')).toBe('xn--acme-9ta')
		})

		it('should leave a label that was never in that code alone', () => {
			// GIVEN ordinary labels, one of them all digits
			// WHEN each is read
			// THEN each comes back untouched. Only a label wearing the opening is put
			// back, because a reader asked about a plain one also tries to read it as
			// a machine address and answers "0.0.0.1" for the "1" read below
			expect(hostLabel('192.168.1.10')).toBe('1')
			expect(hostLabel('acme.com')).toBe('acme')
			expect(hostLabel('my_host.example.com')).toBe('example')
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

	describe('when the fetched page is on a social platform', () => {
		it('should not read a platform page as the company own site', () => {
			// GIVEN an agency named after the platform it works on, and a page
			// fetched from that platform
			const agency: EntityTargets = {
				cores: ['facebookadsagency'],
				words: ['facebook'],
				domains: [],
				places: [],
			}

			// WHEN asked whether the run reached the company's own site
			// THEN no. A page there belongs to whoever opened the account, and
			// counting it would let a mailbox printed on Facebook be harvested as
			// this company's own
			expect(reachedOwnSite(agency, [{ host: 'facebook.com' }])).toBe(false)
			expect(reachedOwnSite(agency, [{ host: 'es-la.facebook.com' }])).toBe(
				false,
			)
		})

		it('should still read the company own domain as its site', () => {
			// GIVEN the same agency at the domain it registered itself
			const agency: EntityTargets = {
				cores: ['facebookadsagency'],
				words: ['facebook'],
				domains: [],
				places: [],
			}

			// WHEN asked — THEN yes: the refusal is about the platform, not the word
			expect(reachedOwnSite(agency, [{ host: 'facebookadsagency.com' }])).toBe(
				true,
			)
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

		it("should accept the company's own domain written with an accent", () => {
			// GIVEN a French firm whose domain holds an accent, so it travels in the
			// code a web address can carry, and a second firm's accented domain
			// WHEN this reading — the stricter of the two, which picks the ONE site a
			// run then goes and reads — is asked about each
			// THEN the company's own is its own and the stranger's is not. Left in
			// the code the label spells nothing, and the run would decline to open
			// the company's own site at all
			const energie: EntityTargets = {
				cores: ['energiesolaire'],
				words: ['energie', 'solaire'],
				domains: [],
				places: [],
			}
			expect(isOwnSiteHost(energie, 'xn--nergie-solaire-9jb.fr')).toBe(true)
			expect(isOwnSiteHost(energie, 'xn--construccionsgarca-xyb.cat')).toBe(
				false,
			)
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

	describe('when the host is a social platform', () => {
		it('should reject a platform, however plainly the name spells it', () => {
			// GIVEN an agency whose name spells a platform's own label
			const agency: EntityTargets = {
				cores: ['facebookadsagency'],
				words: ['facebook'],
				domains: [],
				places: [],
			}

			// WHEN that platform is weighed as the site to go and read
			// THEN no. A wrong yes here anchors the whole run on Facebook and writes
			// back whatever it serves as this company's facts
			expect(isOwnSiteHost(agency, 'facebook.com')).toBe(false)
			expect(isOwnSiteHost(agency, 'fr.linkedin.com')).toBe(false)
		})

		it('should reject a platform already stored as the company website', () => {
			// GIVEN a company whose website on file is a Facebook page, which is how
			// a row left behind by the old behaviour arrives
			const stored: EntityTargets = {
				cores: ['lipotech'],
				words: ['lipotech'],
				domains: ['facebook.com'],
				places: [],
			}

			// WHEN the run looks for the site to go and read
			// THEN still no. Honouring it would send every one of that company's runs
			// off to read Facebook and write back whatever it served
			expect(isOwnSiteHost(stored, 'facebook.com')).toBe(false)
		})

		it('should still accept an ordinary host the caller supplied', () => {
			// GIVEN the host the caller handed over for a company
			// WHEN asked — THEN yes, as before: the refusal above is about platforms,
			// not about supplied domains
			const anchored: EntityTargets = { ...garcia, domains: ['tg.example'] }
			expect(isOwnSiteHost(anchored, 'tg.example')).toBe(true)
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
			}).targets
			const plain = deriveEntityTargets({
				schemaName: 'company_enrichment_v1',
				query: 'Muñoz SL',
				subjects: [{ table: 'companies', name: 'Muñoz SL' }],
			}).targets

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
			}).targets as EntityTargets

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
			}).targets as EntityTargets

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
			}).targets as EntityTargets

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

describe('collapse', () => {
	describe('when a letter is not an accented a–z one but a letter of its own', () => {
		it('should write it as the plain letters it stands for', () => {
			// GIVEN names whose letters accent-stripping cannot turn into a–z
			// WHEN each is folded
			// THEN each letter is written as what it stands for, rather than dropped.
			// Dropped, "Straßenbau" reads as "straenbau" — a key that is not empty, so
			// every check believes it and none reports a problem
			expect(collapse('Straßenbau')).toBe('strassenbau')
			expect(collapse('Nørgaard')).toBe('norgaard')
			expect(collapse('Łukasz')).toBe('lukasz')
			expect(collapse('Cœur')).toBe('coeur')
			expect(collapse('Þór')).toBe('thor')
			expect(collapse('Işık')).toBe('isik')
			expect(collapse('Đuro')).toBe('duro')
			expect(collapse('Æther')).toBe('aether')
		})

		it('should read a name and its own web address to the same thing', () => {
			// GIVEN each company beside the address it registered
			// WHEN both are folded
			// THEN they meet. This is the whole point: a name is only ever compared
			// against an address, so the two have to fold to the same letters
			for (const [name, host] of [
				['Straßenbau Weber', 'strassenbau-weber.de'],
				['Nørgaard VVS', 'norgaard-vvs.dk'],
				['Łukasz Instalacje', 'lukasz-instalacje.pl'],
				['Þór Raflagnir', 'thor-raflagnir.is'],
			] as const) {
				expect(collapse(host).startsWith(collapse(name))).toBe(true)
			}
		})

		it('should fold a plain-letter name exactly as accent-stripping alone would', () => {
			// GIVEN names holding nothing but plain letters, digits and punctuation —
			// which is nearly every name this product has ever seen
			// WHEN folded
			// THEN each reads as taking the accents off would read it on its own. This
			// is why writing the other letters out cannot make two unrelated companies
			// match: the rewriting only ever touches a letter that is not a plain one
			for (const name of [
				'Acme Logistics S.L.',
				'Transportes García',
				'XPO Logistics',
				'Grupo Ferré 2000',
				'ASM',
			]) {
				expect(collapse(name)).toBe(
					name
						.normalize('NFKD')
						.replace(/\p{Diacritic}/gu, '')
						.toLowerCase()
						.replace(/[^a-z0-9]/g, ''),
				)
			}
		})

		it('should answer for each letter with plain letters and nothing else', () => {
			// GIVEN the generated table, every key of which is dropped straight into a
			// character class to find the letters worth rewriting
			// WHEN each row is read
			// THEN every key is one letter and every answer is plain letters. A key
			// carrying a "]" or a backslash would either break that character class
			// on the way in or quietly change which letters it matches, and the
			// generator's promise to emit letters only is the only thing stopping it
			for (const [letter, plain] of EQUIVALENT_LETTERS) {
				expect(letter).toMatch(/^\p{Letter}$/u)
				expect(plain).toMatch(/^[a-z]+$/)
			}
		})

		it('should keep no row the fold has already dealt with before it looks', () => {
			// GIVEN the same table
			// WHEN each key is put through the steps that run before the table is
			// consulted — taken apart, accent marks off, lower-cased
			// THEN the key comes back unchanged and is not already plain. A row for
			// "ǽ" would never be reached, because by then the letter is "æ", and a
			// row nothing reads is a row that reads as needed and is not
			for (const [letter] of EQUIVALENT_LETTERS) {
				const asTheFoldSeesIt = letter
					.normalize('NFKD')
					.replace(/\p{Diacritic}/gu, '')
					.toLowerCase()
				expect(asTheFoldSeesIt).toBe(letter)
				expect(asTheFoldSeesIt).not.toMatch(/^[a-z]+$/)
			}
		})

		it('should leave the letters no language places against a–z alone', () => {
			// GIVEN a letter the generated table has no answer for
			// WHEN folded
			// THEN it is still dropped, and the name still finds nothing. Written down
			// rather than hidden: placing these letters needs a fold that knows the
			// languages that write them, which this is not
			expect(collapse('Sáme ŋiella')).toBe('sameiella')
		})
	})

	describe('when the same reading is asked for word by word', () => {
		it('should agree with the whole-run reading', () => {
			// GIVEN a name the plain-letter table rewrites
			// WHEN read as one run and as words
			// THEN the words joined are the run. The two readings must not drift —
			// one guard reads an address as words and another as a run
			for (const name of ['Straßenbau Weber', 'Þór Nørgaard', 'Işık Cœur']) {
				expect(foldTokens(name).join('')).toBe(collapse(name))
			}
		})
	})
})

describe('nameSpellings — vowels a company writes two ways', () => {
	describe('when the name carries one of them', () => {
		it('should offer the spelling its own domain may use', () => {
			// GIVEN German and Nordic names whose vowels have a second written form
			// WHEN read
			// THEN both forms come back, the name as written first. A German firm
			// registers "mueller.de" as readily as "muller.de", and the plain-letter
			// table alone only ever produces the second
			expect(spellingsWithoutForms('Müller Elektro')).toEqual([
				'mullerelektro',
				'muellerelektro',
			])
			expect(spellingsWithoutForms('Nørgaard VVS')).toEqual([
				'norgaardvvs',
				'noergaardvvs',
			])
			expect(spellingsWithoutForms('Håkon El')).toEqual(['hakonel', 'haakonel'])
		})
	})

	describe('when the name does not carry one', () => {
		it('should not invent a second reading for it', () => {
			// GIVEN two different companies, one written with the vowel and one with
			// the plain letters it may also be written as
			// WHEN each is asked whether the other's domain is its own
			// THEN neither is: only a name that actually carries the vowel is read
			// twice, so a name already spelled "Mueller" gains nothing and a name
			// spelled "Muller" gains nothing
			expect(nameSpellings('Mueller GmbH')).toEqual(['Mueller GmbH'])
			expect(nameSpellings('Muller SL')).toEqual(['Muller SL'])
			expect(
				ownSiteVerdict({
					name: 'Muller SL',
					website: 'https://mueller.de',
					runWords: noRunWords,
				}),
			).toBe('unknown')
			expect(
				ownSiteVerdict({
					name: 'Mueller GmbH',
					website: 'https://muller.de',
					runWords: noRunWords,
				}),
			).toBe('unknown')
		})

		it('should read it the same whether the accent is one character or two', () => {
			// GIVEN one company name written both ways a page may carry it: the vowel
			// as a single character, and the plain letter followed by a mark of its
			// own. The two are indistinguishable on screen
			const asOneCharacter = 'Müller Elektro'
			const asLetterAndMark = 'Müller Elektro'
			expect(asOneCharacter).not.toBe(asLetterAndMark)

			// WHEN each is read
			// THEN both offer the spelling the company's own domain uses. Searched as
			// written, the second spells its vowel as two characters, finds nothing to
			// write out, and the company is looked for only under "muller"
			for (const name of [asOneCharacter, asLetterAndMark]) {
				expect(spellingsWithoutForms(name)).toEqual([
					'mullerelektro',
					'muellerelektro',
				])
				expect(
					ownSiteVerdict({
						name,
						website: 'https://mueller-elektro.de',
						runWords: noRunWords,
					}),
				).toBe('established')
			}
		})

		it('should leave a name with no such vowel read once', () => {
			// GIVEN ordinary names
			// WHEN read
			// THEN one reading each: a name carrying none of these vowels is never
			// read a second way
			expect(nameSpellings('Acme Logistics')).toEqual(['Acme Logistics'])
			expect(nameSpellings('Straßenbau')).toEqual(['Straßenbau'])
		})
	})

	describe('when a name carries several of them', () => {
		it('should stop short of reading it every possible way', () => {
			// GIVEN a name with three such vowels, and one with more
			// WHEN read
			// THEN the readings are capped, and the name as written is always the
			// first — a caller takes that one as the company's identity, so it can
			// never be the reading that gets cut
			const three = nameSpellings('Müller Öl Ähre')
			expect(three.length).toBeLessThanOrEqual(8)
			expect(three[0]).toBe('Müller Öl Ähre')

			const many = nameSpellings('Müller Öl Ähre Åse Nør')
			expect(many.length).toBeLessThanOrEqual(8)
			expect(many[0]).toBe('Müller Öl Ähre Åse Nør')
		})
	})
})
