import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	HIGH_VALUE_FIELDS,
	MAX_PER_FIELD_SEARCHES,
	MAX_SCAN_ROW_SEARCHES,
	mergePerFieldSearch,
	needsPerFieldSearch,
	perFieldSearchCap,
	perFieldSearchQuery,
	scanRowFields,
} from './per-field-search'
import { runWordsOf } from './run-words'
import { CompetitorScanV1Schema } from './schemas/competitor-scan-v1'
import { ProspectScanV1Schema } from './schemas/prospect-scan-v1'

// A run that named no trades, which is a request about one company on file.
const noRunWords = runWordsOf([])

// A per-field-citation value the way the enrichment schema stores one.
const sourced = (value: string) => ({ value, source_id: 'https://x.test' })

const SCAN = 'prospect_scan_v1'
const COMPETITORS = 'competitor_scan_v1'
const PROFILE = 'company_enrichment_v1'

const forProfile = (findings: unknown, subjectName = 'Acme Corp') =>
	needsPerFieldSearch({ findings, schemaName: PROFILE, subjectName })

const forScan = (findings: unknown, schemaName: string = SCAN) =>
	needsPerFieldSearch({ findings, schemaName, subjectName: 'unused by a scan' })

const prospectsOf = (findings: unknown) =>
	(findings as { prospects: ReadonlyArray<Record<string, unknown>> }).prospects

describe('needsPerFieldSearch', () => {
	describe('when the run is a company profile', () => {
		it('should return no fields when every high-value one is filled', () => {
			// GIVEN findings whose country/industry/location/size_range all carry a value
			const findings = {
				enrichment: {
					country: sourced('ES'),
					industry: sourced('manufacturing'),
					location: sourced('Barcelona'),
					size_range: sourced('51-200'),
				},
			}
			// WHEN the still-empty high-value fields are computed
			// THEN there is nothing to search for
			expect(forProfile(findings)).toEqual([])
		})

		it('should return only the empty ones, in HIGH_VALUE_FIELDS order', () => {
			// GIVEN industry + size_range filled, country + location empty
			const findings = {
				enrichment: {
					industry: sourced('manufacturing'),
					size_range: sourced('51-200'),
					country: { value: null },
				},
			}
			// WHEN computed
			// THEN the two empty high-value fields come back against the subject's name
			expect(forProfile(findings)).toEqual([
				{ name: 'Acme Corp', field: 'country' },
				{ name: 'Acme Corp', field: 'location' },
			])
		})

		it('should ignore non-high-value fields that are empty', () => {
			// GIVEN the high-value four filled and the rest of the enrichment empty
			const findings = {
				enrichment: {
					country: sourced('GB'),
					industry: sourced('retail'),
					location: sourced('London'),
					size_range: sourced('1000+'),
				},
			}
			// WHEN computed
			// THEN only high-value fields are ever searched, so nothing is returned
			expect(forProfile(findings)).toEqual([])
		})
	})

	describe('when a company profile has no profile block at all', () => {
		it('should ask for nothing, because a recovered value has nowhere to go', () => {
			// GIVEN findings carrying no enrichment block — the shape a run lands in
			// when extraction returned nothing usable
			// WHEN computed
			// THEN no search is proposed: the merge could not fold an answer back in,
			// so firing paid searches would only buy an answer to throw away
			expect(forProfile({})).toEqual([])
			expect(forProfile(null)).toEqual([])
			expect(forProfile({ enrichment: null })).toEqual([])
			expect(forProfile('not an object')).toEqual([])
		})
	})

	describe('when the run is a discovery scan', () => {
		it('should ask about every company that is missing a fact', () => {
			// GIVEN one company with a website and one with nothing but a name
			const findings = {
				prospects: [
					{ name: 'Acme', website: 'https://acme.test' },
					{ name: 'Beta' },
				],
			}
			// WHEN computed
			// THEN each company is asked about by its own name, never the request's
			expect(forScan(findings)).toEqual([
				{ name: 'Acme', field: 'employee_estimate' },
				{ name: 'Acme', field: 'location' },
				{ name: 'Beta', field: 'website' },
				{ name: 'Beta', field: 'employee_estimate' },
				{ name: 'Beta', field: 'location' },
			])
		})

		it('should reach a competitor list, but only for facts it can hold', () => {
			// GIVEN a competitor scan's own list
			const findings = { competitors: [{ name: 'Rival' }] }
			// WHEN computed
			// THEN the list is reached exactly as a prospect list is, but a headcount
			// is never asked about: a competitor row has no place to put one, so the
			// search would be paid for and the answer thrown away
			expect(forScan(findings, COMPETITORS)).toEqual([
				{ name: 'Rival', field: 'website' },
			])
		})

		it('should count a headcount paired with its source as filled', () => {
			// GIVEN a headcount stored as a number beside the page that stated it
			const findings = {
				prospects: [
					{
						name: 'Acme',
						website: 'https://acme.test',
						employee_estimate: { value: 42, source_id: 'https://acme.test' },
						location: 'Valencia',
					},
				],
			}
			// WHEN computed
			// THEN nothing is missing — a number is a value even though it is not text
			expect(forScan(findings)).toEqual([])
		})

		it('should treat a blanked or absent value as still missing', () => {
			// GIVEN a website blanked by a guard, one that is only whitespace, and a
			// headcount whose value was nulled
			const findings = {
				prospects: [
					{
						name: 'A',
						website: '   ',
						employee_estimate: { value: null },
						location: 'Valencia',
					},
					{
						name: 'B',
						website: null,
						employee_estimate: { value: 7 },
						location: '  ',
					},
				],
			}
			// WHEN computed
			// THEN each of those reads as a gap worth searching for
			expect(forScan(findings)).toEqual([
				{ name: 'A', field: 'website' },
				{ name: 'A', field: 'employee_estimate' },
				{ name: 'B', field: 'website' },
				{ name: 'B', field: 'location' },
			])
		})

		it('should skip a row that names no company', () => {
			// GIVEN rows with a blank name, no name, and a non-string name
			const findings = {
				prospects: [
					{ name: '   ' },
					{ website: 'https://x.test' },
					{ name: 42 },
					{ name: 'Real' },
				],
			}
			// WHEN computed
			// THEN only the company that can actually be searched for is asked about —
			// a quoted blank would search for nothing
			expect(forScan(findings)).toEqual([
				{ name: 'Real', field: 'website' },
				{ name: 'Real', field: 'employee_estimate' },
				{ name: 'Real', field: 'location' },
			])
		})

		it('should ask for nothing when the scan found nobody', () => {
			// GIVEN a scan whose list is empty, missing, or not a list at all
			// WHEN computed
			// THEN there is no company to search about, and the profile fields are
			// never fallen back on
			expect(forScan({ prospects: [] })).toEqual([])
			expect(forScan({})).toEqual([])
			expect(forScan({ prospects: 'nope' })).toEqual([])
			expect(forScan(null)).toEqual([])
		})

		it('should never fall back to profile fields when a scan carries a profile block', () => {
			// GIVEN a scan whose findings somehow also carry an enrichment block
			const findings = {
				prospects: [],
				enrichment: { country: { value: null } },
			}
			// WHEN computed
			// THEN the schema decides the shape, so no profile field is searched for —
			// a scan has nowhere to put one
			expect(forScan(findings)).toEqual([])
		})
	})
})

describe('perFieldSearchCap', () => {
	describe('when the run is a company profile', () => {
		it('should cap at the per-fact allowance', () => {
			// GIVEN a profile, whose gaps are facts about one company
			// THEN the cap is the smaller per-fact one
			expect(perFieldSearchCap(PROFILE)).toBe(MAX_PER_FIELD_SEARCHES)
			expect(perFieldSearchCap('freeform')).toBe(MAX_PER_FIELD_SEARCHES)
		})
	})

	describe('when the run is a discovery scan', () => {
		it('should cap at the larger per-company allowance', () => {
			// GIVEN a scan, whose gaps are whole companies rather than facts
			// THEN the cap is raised, since three searches across a list would
			// recover almost nothing
			expect(perFieldSearchCap(SCAN)).toBe(MAX_SCAN_ROW_SEARCHES)
			expect(perFieldSearchCap(COMPETITORS)).toBe(MAX_SCAN_ROW_SEARCHES)
			expect(MAX_SCAN_ROW_SEARCHES).toBeGreaterThan(MAX_PER_FIELD_SEARCHES)
		})
	})
})

describe('perFieldSearchQuery', () => {
	describe('when a city was queried', () => {
		it('should quote the name and include the city and the field intent', () => {
			// GIVEN a company name, a city, and the size field
			// WHEN the query is built
			// THEN it phrases a focused search
			expect(perFieldSearchQuery('Acme Corp', 'Barcelona', 'size_range')).toBe(
				'"Acme Corp" Barcelona number of employees',
			)
		})
	})

	describe('when no city was queried', () => {
		it('should omit the city and trim the name', () => {
			// GIVEN a padded name, no city, and the country field
			expect(perFieldSearchQuery('  Acme Corp  ', undefined, 'country')).toBe(
				'"Acme Corp" head office country',
			)
		})

		it('should treat a blank city as no city', () => {
			// GIVEN a city that is only whitespace
			expect(perFieldSearchQuery('Acme', '   ', 'country')).toBe(
				'"Acme" head office country',
			)
		})
	})

	describe('when the fact wanted is one only a scan asks for', () => {
		it('should phrase the website and headcount searches', () => {
			// GIVEN the two facts a scan's list most often comes back missing
			// WHEN the queries are built
			// THEN each is phrased for search rather than named as a field
			expect(perFieldSearchQuery('Acme', undefined, 'website')).toBe(
				'"Acme" official website',
			)
			expect(perFieldSearchQuery('Acme', 'Girona', 'employee_estimate')).toBe(
				'"Acme" Girona number of employees',
			)
		})
	})

	describe('when the field has no known intent', () => {
		it('should fall back to the raw field name', () => {
			// GIVEN a field with no phrasing mapped
			expect(perFieldSearchQuery('Acme', undefined, 'current_tools')).toBe(
				'"Acme" current_tools',
			)
		})
	})
})

describe('mergePerFieldSearch', () => {
	describe('when the re-extraction recovered an empty profile field', () => {
		it('should fill only the empty high-value fields and count them', () => {
			// GIVEN findings with country empty and industry already grounded
			const findings = {
				enrichment: {
					industry: sourced('manufacturing'),
					country: { value: null },
				},
			}
			// AND a refreshed extraction that now carries a country and a different industry
			const refreshed = {
				enrichment: {
					industry: sourced('logistics'),
					country: sourced('ES'),
				},
			}
			// WHEN merged
			const { findings: next, filled } = mergePerFieldSearch(
				findings,
				refreshed,
				PROFILE,
				noRunWords,
			)
			// THEN the empty country is filled but the grounded industry is untouched
			expect(filled).toBe(1)
			const enrichment = (next as { enrichment: Record<string, unknown> })
				.enrichment
			expect(enrichment['country']).toEqual(sourced('ES'))
			expect(enrichment['industry']).toEqual(sourced('manufacturing'))
		})
	})

	describe('when the re-extraction recovered nothing', () => {
		it('should return the findings unchanged with a zero count', () => {
			// GIVEN findings with country already filled
			const findings = { enrichment: { country: sourced('ES') } }
			// AND a refreshed extraction with no enrichment block
			// WHEN merged
			const {
				findings: next,
				filled,
				added,
			} = mergePerFieldSearch(findings, {}, PROFILE, noRunWords)
			// THEN nothing is filled and the same findings come back
			expect(filled).toBe(0)
			expect(added).toBe(0)
			expect(next).toBe(findings)
		})
	})

	describe('when the pages this round fetched name people', () => {
		it('should carry the new contacts across and count them', () => {
			// GIVEN findings that named one person
			const findings = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig', role: sourced('CEO') }],
			}
			// AND a re-extraction that names her again plus someone new
			const refreshed = {
				enrichment: { country: sourced('ES') },
				contacts: [
					{ name: 'Anna Puig', role: sourced('CEO') },
					{ name: 'Marc Vila', role: sourced('Operations Manager') },
				],
			}

			// WHEN merged
			const { findings: next, contactsChanged } = mergePerFieldSearch(
				findings,
				refreshed,
				PROFILE,
				noRunWords,
			)

			// THEN the second person is kept, the first not duplicated
			expect(contactsChanged).toBe(true)
			const contacts = (next as { contacts: ReadonlyArray<{ name: string }> })
				.contacts
			expect(contacts.map(contact => contact.name)).toEqual([
				'Anna Puig',
				'Marc Vila',
			])
		})

		it('should keep a person the re-extraction no longer names', () => {
			// GIVEN a person found earlier whom the fresh pass missed
			const findings = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig', role: sourced('CEO') }],
			}
			const refreshed = { enrichment: { country: sourced('ES') }, contacts: [] }

			// WHEN merged — THEN a second look never loses somebody
			const { findings: next, contactsChanged } = mergePerFieldSearch(
				findings,
				refreshed,
				PROFILE,
				noRunWords,
			)
			expect(contactsChanged).toBe(false)
			expect(next).toBe(findings)
		})

		it('should keep a title the second look put on someone already named', () => {
			// GIVEN a person found earlier whose job title was never established
			const findings = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig' }],
			}
			// AND a re-extraction that reads her title off the team page
			const refreshed = {
				enrichment: { country: sourced('ES') },
				contacts: [{ name: 'Anna Puig', role: sourced('CEO') }],
			}

			// WHEN merged
			const { findings: next, contactsChanged } = mergePerFieldSearch(
				findings,
				refreshed,
				PROFILE,
				noRunWords,
			)

			// THEN the title is kept, even though the list is exactly as long as it
			// was — a title is the whole reason for opening a team page, and counting
			// people alone would throw it away
			expect(contactsChanged).toBe(true)
			const contacts = (
				next as { contacts: ReadonlyArray<{ role?: { value: string } }> }
			).contacts
			expect(contacts[0]?.role?.value).toBe('CEO')
		})
	})

	describe("when the re-extraction re-reads a scan's list", () => {
		it('should fill the right company even though the order changed', () => {
			// GIVEN three companies, one already carrying a website
			const findings = {
				prospects: [
					{ name: 'Acme', why_relevant: 'x' },
					{ name: 'Beta', website: 'https://beta.test' },
					{ name: 'Gamma' },
				],
			}
			// AND a wider read that returns them in a different order, with a worse
			// website for Beta and a company nobody had named
			const refreshed = {
				prospects: [
					{ name: 'Delta', website: 'https://delta.test' },
					{ name: 'Gamma', website: 'https://gamma.test' },
					{
						name: 'Acme',
						website: 'https://acme.test',
						employee_estimate: { value: 42, source_id: 'https://acme.test' },
					},
					{ name: 'Beta', website: 'https://wrong.test' },
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)

			// THEN each recovered value lands on the company it belongs to, the
			// grounded website is left alone, nobody is dropped, and the new company
			// is appended
			expect(rows.map(row => row['name'])).toEqual([
				'Acme',
				'Beta',
				'Gamma',
				'Delta',
			])
			expect(rows[0]?.['website']).toBe('https://acme.test')
			expect(rows[0]?.['employee_estimate']).toEqual({
				value: 42,
				source_id: 'https://acme.test',
			})
			expect(rows[1]?.['website']).toBe('https://beta.test')
			expect(rows[2]?.['website']).toBe('https://gamma.test')
			expect(merged.filled).toBe(3)
			expect(merged.added).toBe(1)
			expect(merged.contactsChanged).toBe(false)
		})

		it('should fold two spellings of one company together', () => {
			// GIVEN a company written with its legal suffix punctuated
			const findings = { prospects: [{ name: 'Acme S.L.' }] }
			// AND a second look that writes the same company differently
			const refreshed = {
				prospects: [{ name: 'acme sl', website: 'https://acme.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN one company stays one company, keeping the name first written
			expect(rows).toHaveLength(1)
			expect(rows[0]?.['name']).toBe('Acme S.L.')
			expect(rows[0]?.['website']).toBe('https://acme.test')
			expect(merged.added).toBe(0)
		})

		it('should fold a company the second look met under its fuller legal name', () => {
			// GIVEN a company first met under the name it trades as
			const findings = {
				prospects: [
					{ name: 'Civera Electrificaciones', why_relevant: 'Installer.' },
				],
			}
			// AND a second look that met it through a register, which prints the legal
			// form on the end
			const refreshed = {
				prospects: [
					{
						name: 'Civera Electrificaciones, S.L.',
						website: 'https://civeraelectrificaciones.com/',
						location: 'Valencia',
					},
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)

			// THEN it is one company that gained a site and a place, not two rows. A
			// register or a directory is exactly where a second look goes, and the
			// fuller name it prints there is the ordinary case, not an unusual one
			expect(rows).toHaveLength(1)
			expect(rows[0]?.['name']).toBe('Civera Electrificaciones')
			expect(rows[0]?.['website']).toBe('https://civeraelectrificaciones.com/')
			expect(rows[0]?.['location']).toBe('Valencia')
			expect(merged.added).toBe(0)
		})

		it('should fold a company the second look met under a different name entirely', () => {
			// GIVEN a company first met under its trading name, with its site
			const findings = {
				prospects: [{ name: 'Asenel', website: 'https://www.asenel.net/' }],
			}
			// AND a second look that names it in full, on the same site
			const refreshed = {
				prospects: [
					{
						name: 'ASENEL (Asistencia Energética Eléctrica S.L.U.)',
						website: 'https://www.asenel.net',
						location: 'Valencia',
					},
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)

			// THEN the shared site settles it, as it does for the fold that runs over
			// the list itself — the two names have nothing in common to match on
			expect(rows).toHaveLength(1)
			expect(rows[0]?.['location']).toBe('Valencia')
			expect(merged.added).toBe(0)
		})

		it('should fold two spellings that differ only by an accent', () => {
			// GIVEN a Catalan company name carrying its accent and legal suffix
			const findings = { prospects: [{ name: 'Transports Munné, S.L.' }] }
			// AND a second look that read the same company off a page that dropped both
			const refreshed = {
				prospects: [
					{ name: 'Transports Munne SL', website: 'https://munne.test' },
				],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN it is still one company — most of the market this searches writes
			// names with accents, and matching on the letters alone would have listed
			// the same firm twice and counted the duplicate as a new find
			expect(rows).toHaveLength(1)
			expect(rows[0]?.['name']).toBe('Transports Munné, S.L.')
			expect(rows[0]?.['website']).toBe('https://munne.test')
			expect(merged.added).toBe(0)
		})

		it('should not fold two genuinely different companies together', () => {
			// GIVEN a company whose name is a prefix of another's
			const findings = { prospects: [{ name: 'Acme' }] }
			const refreshed = {
				prospects: [{ name: 'Acme Holding', website: 'https://holding.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN Acme keeps its blank rather than inheriting another company's site,
			// and the other company is listed in its own right — a duplicate is a far
			// smaller harm than a website on the wrong company
			expect(rows[0]?.['website']).toBeUndefined()
			expect(rows.map(row => row['name'])).toEqual(['Acme', 'Acme Holding'])
			expect(merged.added).toBe(1)
		})

		it('should fold a branch office the round found onto the company listed', () => {
			// GIVEN a company on the list, and a second look that names one of its
			// branch offices — its name and then the town the branch sits in, with no
			// site of its own
			const findings = {
				prospects: [
					{ name: 'Terre Solaire', website: 'https://terresolaire.test' },
				],
			}
			const refreshed = {
				prospects: [
					{ name: 'Terre Solaire – agence Nantes', location: 'Nantes' },
				],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN one company, keeping the town the branch brought. The fold that runs
			// before these rounds cannot see a company found after it, so a round that
			// leaves a branch standing puts the duplicate straight into the answer
			expect(rows.map(row => row['name'])).toEqual(['Terre Solaire'])
			expect(rows[0]?.['location']).toBe('Nantes')
			expect(merged.added).toBe(0)
		})

		it('should fold a company the round gave the site of one already listed', () => {
			// GIVEN a company at the domain that spells its name, and a round that names
			// it again under a longer name and hands it the same site — the shape a live
			// run returned as two rows both on aeroxsense.com
			const findings = {
				prospects: [
					{ name: 'AeroXsense', website: 'https://www.aeroxsense.test/' },
				],
			}
			const refreshed = {
				prospects: [
					{
						name: 'AeroXsense (Fire Safety)',
						website: 'https://aeroxsense.test/',
					},
				],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN the shared host settles it here too, because the domain says whose it
			// is. A row appended by a round is never put in front of the fold again
			// unless this step folds it
			expect(rows).toHaveLength(1)
			expect(merged.added).toBe(0)
		})

		it('should still count a genuinely new company as one the list gained', () => {
			// GIVEN a round that names a company sharing an opening word with a listed
			// one, in a town its name does not end on
			const findings = {
				prospects: [
					{ name: 'Terre Solaire', website: 'https://terresolaire.test' },
				],
			}
			const refreshed = {
				prospects: [{ name: 'Terre Solaire Energie', location: 'Nantes' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN both are listed and the round is credited with the find — sharing an
			// opening word is not being somebody's branch
			expect(rows.map(row => row['name'])).toEqual([
				'Terre Solaire',
				'Terre Solaire Energie',
			])
			expect(merged.added).toBe(1)
		})

		it('should still credit a find when the round also joins two already listed', () => {
			// GIVEN two rows that are one company nobody could yet tell apart — one
			// carrying the site, the other only the name
			const findings = {
				prospects: [
					{ name: 'Acme' },
					{ name: 'Acme Group', website: 'https://acme.test' },
				],
			}
			// AND a round that hands the first row that same site, which shows the two
			// were always one, and names a company nobody had
			const refreshed = {
				prospects: [
					{ name: 'Acme', website: 'https://acme.test' },
					{ name: 'Delta Systems', website: 'https://delta.test' },
				],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN the list holds the one company and the new one, and the round is
			// credited with the find. Counting the length instead would read nothing
			// gained — two rows in, two rows out — and stop the rounds a round early
			expect(rows).toHaveLength(2)
			expect(merged.added).toBe(1)
		})

		it('should append a company the second look names twice only once', () => {
			// GIVEN a re-extraction that names the same NEW company in two rows
			const findings = { prospects: [{ name: 'Zeta' }] }
			const refreshed = {
				prospects: [
					{ name: 'Acme', website: 'https://a.test' },
					{ name: 'Acme', website: 'https://b.test' },
				],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN it joins the list once — the list's length decides whether a scan
			// came back too thin to trust, so counting one company twice would pass a
			// thin scan off as a healthy one
			expect(rows.map(row => row['name'])).toEqual(['Zeta', 'Acme'])
			expect(merged.added).toBe(1)
		})

		it('should take the first mention when the second look names one company twice', () => {
			// GIVEN a re-extraction that lists the same company twice
			const findings = { prospects: [{ name: 'Acme' }] }
			const refreshed = {
				prospects: [
					{ name: 'Acme', website: 'https://first.test' },
					{ name: 'Acme', website: 'https://second.test' },
				],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)
			// THEN one of them is taken and the fold stays stable, with no duplicate
			// appended for the company already known
			expect(rows).toHaveLength(1)
			expect(rows[0]?.['website']).toBe('https://first.test')
			expect(merged.added).toBe(0)
		})

		it('should add companies to a list that came back empty', () => {
			// GIVEN a first pass that found nobody
			const findings = { prospects: [] }
			const refreshed = {
				prospects: [{ name: 'Acme', website: 'https://acme.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			// THEN the wider read's find is kept — an empty list is exactly the one
			// with the most to gain from looking again
			expect(prospectsOf(merged.findings).map(row => row['name'])).toEqual([
				'Acme',
			])
			expect(merged.added).toBe(1)
		})

		it('should ignore a company the second look cannot name', () => {
			// GIVEN a re-extraction carrying a row with no usable name
			const findings = { prospects: [{ name: 'Acme' }] }
			const refreshed = {
				prospects: [{ website: 'https://nameless.test' }, { name: '  ' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			// THEN nothing is appended, since a company with no name cannot be worked
			// with or told apart from another
			expect(merged.added).toBe(0)
			expect(merged.findings).toBe(findings)
		})

		it('should keep a company a round met on the trade body page a listed one was given', () => {
			// GIVEN a company already on the list, standing on the page a trade body's
			// member list gave it
			const findings = {
				prospects: [
					{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				],
			}
			// AND a round that names a different installer and hands it a page on that
			// same member list — one claimant each time, so nothing before this fold
			// ever sees the two of them together
			const refreshed = {
				prospects: [
					{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)

			// THEN both companies ship. The domain spells neither of them, so it is
			// nobody's own site and is no reason to call them one company
			expect(rows.map(row => row['name'])).toEqual([
				'Electricidad Mora',
				'Instalaciones Rubio',
			])
			// AND the round is credited with the find, or the rounds stop a round early
			// on the reading that it turned up nobody
			expect(merged.added).toBe(1)
			// AND the fold reports that it joined no row to another, which is the
			// number that would show this company going missing
			expect(merged.folded).toBe(0)
		})

		it('should report the row it folds when a round shows two listed companies are one', () => {
			// GIVEN two rows the list holds under different names, one of them on the
			// domain that spells the other
			const findings = {
				prospects: [
					{ name: 'Terre Solaire', why_relevant: 'Installer.' },
					{
						name: 'Soleil du Sud',
						website: 'https://terresolaire.test/mentions-legales',
					},
				],
			}
			// AND a round that brings the first row the site it had been missing
			const refreshed = {
				prospects: [
					{ name: 'Terre Solaire', website: 'https://terresolaire.test' },
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)

			// THEN one company, and the fold says it joined a row — a real fold, for
			// the good reason that the site now says the two rows are one company
			expect(prospectsOf(merged.findings).map(row => row['name'])).toEqual([
				'Terre Solaire',
			])
			expect(merged.folded).toBe(1)
			// AND nothing is credited as found, because nobody new was
			expect(merged.added).toBe(0)
		})

		it('should keep every company a run of rounds meets on one trade body host', () => {
			// GIVEN a first list of one company on a member page
			let findings: unknown = {
				prospects: [
					{ name: 'Electricidad Mora', website: 'https://aemiat.com/e-mora/' },
				],
			}
			// AND three more rounds, each naming one more installer on that same host
			const rounds = [
				{ name: 'Instalaciones Rubio', website: 'https://aemiat.com/rubio/' },
				{ name: 'Montajes Tejero', website: 'https://aemiat.com/tejero/' },
				{ name: 'Climatización Sanz', website: 'https://aemiat.com/sanz/' },
			]

			// WHEN each round is folded in as the run folds it
			for (const found of rounds) {
				findings = mergePerFieldSearch(
					findings,
					{ prospects: [found] },
					SCAN,
					noRunWords,
				).findings
			}

			// THEN four rows went in and four come out. Each round is innocent on its
			// own, and it is only what they add up to that could shorten the list
			expect(prospectsOf(findings).map(row => row['name'])).toEqual([
				'Electricidad Mora',
				'Instalaciones Rubio',
				'Montajes Tejero',
				'Climatización Sanz',
			])
		})

		it('should fold a round onto the listed company whose name the domain spells', () => {
			// GIVEN a company on the list at the domain that spells its name
			const findings = {
				prospects: [
					{ name: 'Terre Solaire', website: 'https://terresolaire.test' },
				],
			}
			// AND a round meeting it again under a legal name the domain says nothing of
			const refreshed = {
				prospects: [
					{
						name: 'SAS Soleil du Sud',
						website: 'https://terresolaire.test/mentions-legales',
						location: 'Lyon',
					},
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)

			// THEN one company, which gained the town the round found. Who owns the
			// domain is read over both sides at once, so the listed row's name settles
			// the site for the round's row as well — the trade name beside the legal
			// one, which is what this fold is for
			expect(rows.map(row => row['name'])).toEqual(['Terre Solaire'])
			expect(rows[0]?.['location']).toBe('Lyon')
			expect(merged.added).toBe(0)
			// AND the join is reported, because a website joined two names on its own
			// — rightly this time, but that is the shape that can go wrong
			expect(merged.folded).toBe(1)
		})

		it('should not report a round that meets listed companies by their names', () => {
			// GIVEN a list of two companies and a round that re-reads both of them,
			// which is what every round ordinarily does
			const findings = {
				prospects: [
					{ name: 'Acme Instal' },
					{ name: 'Beta Muntatges', website: 'https://beta.test' },
				],
			}
			const refreshed = {
				prospects: [
					{ name: 'Acme Instal SL', location: 'Girona' },
					{ name: 'Beta Muntatges', location: 'Reus' },
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)

			// THEN nothing is reported as joined. The rows met by name, which is the
			// reason the rounds run at all — counting those would bury the one join
			// this number exists to show
			expect(prospectsOf(merged.findings)).toHaveLength(2)
			expect(merged.folded).toBe(0)
		})

		it('should keep a round company that meets a listed one on neither a name nor a site', () => {
			// GIVEN a company first met under a legal name, with no site
			const findings = {
				prospects: [{ name: 'Soleil du Sud SAS', why_relevant: 'Installer.' }],
			}
			// AND a round that names what is really the same firm under its trading
			// name, bringing the domain that spells that one
			const refreshed = {
				prospects: [
					{ name: 'Terre Solaire', website: 'https://terresolaire.test' },
				],
			}

			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			const rows = prospectsOf(merged.findings)

			// THEN two rows, because nothing yet ties the two names together: the listed
			// row carries no site to be met on. The cost of this fold's care is a
			// duplicate the reader sorts out, never a company taken off the list
			expect(rows.map(row => row['name'])).toEqual([
				'Soleil du Sud SAS',
				'Terre Solaire',
			])
			expect(merged.added).toBe(1)
			expect(merged.folded).toBe(0)
		})

		it('should keep a company the second look no longer names', () => {
			// GIVEN a company found first time round that the wider read missed
			const findings = {
				prospects: [{ name: 'Acme' }, { name: 'Beta' }],
			}
			const refreshed = {
				prospects: [{ name: 'Beta', website: 'https://beta.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			// THEN a second look only ever adds — it never shortens the list
			expect(prospectsOf(merged.findings).map(row => row['name'])).toEqual([
				'Acme',
				'Beta',
			])
		})

		it('should leave the findings untouched when nothing was gained', () => {
			// GIVEN a second look that fills nothing and names nobody new
			const findings = {
				prospects: [{ name: 'Acme', website: 'https://acme.test' }],
			}
			const refreshed = {
				prospects: [{ name: 'Acme', website: 'https://other.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			// THEN the very same findings come back, which is what stops the rounds
			expect(merged.findings).toBe(findings)
			expect(merged.filled).toBe(0)
			expect(merged.added).toBe(0)
		})

		it('should leave the findings alone when there is nowhere to write', () => {
			// GIVEN findings that are not an object at all
			const refreshed = { prospects: [{ name: 'Acme' }] }
			// WHEN merged
			// THEN nothing is invented around them
			expect(
				mergePerFieldSearch(null, refreshed, SCAN, noRunWords).findings,
			).toBe(null)
			expect(
				mergePerFieldSearch('x', refreshed, SCAN, noRunWords).findings,
			).toBe('x')
		})

		it('should leave the findings alone when the second look holds no list', () => {
			// GIVEN a re-extraction that came back with nothing usable
			const findings = { prospects: [{ name: 'Acme' }] }
			// WHEN merged
			// THEN the list is untouched
			expect(mergePerFieldSearch(findings, {}, SCAN, noRunWords).findings).toBe(
				findings,
			)
			expect(
				mergePerFieldSearch(findings, null, SCAN, noRunWords).findings,
			).toBe(findings)
		})

		it('should carry the rest of the findings across untouched', () => {
			// GIVEN findings holding more than the list of companies
			const findings = {
				prospects: [{ name: 'Acme' }],
				pending_paid_actions: [{ tool: 'lookup_registry' }],
			}
			const refreshed = {
				prospects: [{ name: 'Acme', website: 'https://acme.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN, noRunWords)
			// THEN everything beside the list survives the fold
			expect(
				(merged.findings as { pending_paid_actions: unknown })
					.pending_paid_actions,
			).toEqual([{ tool: 'lookup_registry' }])
		})
	})
})

describe('the fields each shape rescues', () => {
	describe('when a run goes looking for what it left empty', () => {
		it('should name the facts a profile and a scan are each worth searching for', () => {
			// GIVEN the two field lists the rescue works from
			// WHEN a run of either shape reaches the gap rounds
			// THEN a profile rescues its firmographics, and a scan rescues what makes
			// a company on a list reachable and worth reaching
			expect(HIGH_VALUE_FIELDS).toEqual([
				'country',
				'industry',
				'location',
				'size_range',
			])
			expect(scanRowFields(SCAN)).toEqual([
				'website',
				'employee_estimate',
				'location',
			])
			expect(scanRowFields(COMPETITORS)).toEqual(['website'])
			expect(scanRowFields('freeform')).toEqual([])
		})

		it('should only name facts the scan schema can actually carry', () => {
			// GIVEN a company row carrying every fact the rescue would search for,
			// put through the very schema the model fills
			const sample: Record<string, unknown> = {
				name: 'Acme',
				website: 'https://acme.test',
				employee_estimate: {
					value: 42,
					source_id: 'https://acme.test',
					confidence: null,
				},
				location: 'Valencia',
				why_relevant: 'matches',
				description: 'a rival',
				citations: [],
			}
			for (const [schemaName, schema, listField] of [
				[SCAN, ProspectScanV1Schema, 'prospects'],
				[COMPETITORS, CompetitorScanV1Schema, 'competitors'],
			] as const) {
				const decoded = Schema.decodeUnknownSync(schema)({
					[listField]: [sample],
				}) as Record<string, ReadonlyArray<Record<string, unknown>>>
				const row = decoded[listField]?.[0] ?? {}
				// WHEN each fact the rescue searches for is looked for on the way out
				// THEN it survived — a fact the schema drops would be searched for
				// every round and merged back nowhere, which is the same waste this
				// rescue was rewritten to stop doing on a company profile
				for (const field of scanRowFields(schemaName)) {
					expect(row).toHaveProperty(field)
				}
			}
		})
	})
})
