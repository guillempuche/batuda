import { describe, expect, it } from 'vitest'

import {
	HIGH_VALUE_FIELDS,
	MAX_PER_FIELD_SEARCHES,
	MAX_SCAN_ROW_SEARCHES,
	mergePerFieldSearch,
	needsPerFieldSearch,
	perFieldSearchCap,
	perFieldSearchQuery,
	SCAN_ROW_FIELDS,
} from './per-field-search'

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
				{ name: 'Beta', field: 'website' },
				{ name: 'Beta', field: 'employee_estimate' },
			])
		})

		it('should read a competitor scan the same way as a prospect scan', () => {
			// GIVEN a competitor scan's own list
			const findings = { competitors: [{ name: 'Rival' }] }
			// WHEN computed
			// THEN it is reached exactly as a prospect list is
			expect(forScan(findings, COMPETITORS)).toEqual([
				{ name: 'Rival', field: 'website' },
				{ name: 'Rival', field: 'employee_estimate' },
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
					{ name: 'A', website: '   ', employee_estimate: { value: null } },
					{ name: 'B', website: null, employee_estimate: { value: 7 } },
				],
			}
			// WHEN computed
			// THEN each of those reads as a gap worth searching for
			expect(forScan(findings)).toEqual([
				{ name: 'A', field: 'website' },
				{ name: 'A', field: 'employee_estimate' },
				{ name: 'B', field: 'website' },
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
			} = mergePerFieldSearch(findings, {}, PROFILE)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
			const rows = prospectsOf(merged.findings)
			// THEN one company stays one company, keeping the name first written
			expect(rows).toHaveLength(1)
			expect(rows[0]?.['name']).toBe('Acme S.L.')
			expect(rows[0]?.['website']).toBe('https://acme.test')
			expect(merged.added).toBe(0)
		})

		it('should not fold two genuinely different companies together', () => {
			// GIVEN a company whose name is a prefix of another's
			const findings = { prospects: [{ name: 'Acme' }] }
			const refreshed = {
				prospects: [{ name: 'Acme Holding', website: 'https://holding.test' }],
			}
			// WHEN merged
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
			const rows = prospectsOf(merged.findings)
			// THEN Acme keeps its blank rather than inheriting another company's site,
			// and the other company is listed in its own right — a duplicate is a far
			// smaller harm than a website on the wrong company
			expect(rows[0]?.['website']).toBeUndefined()
			expect(rows.map(row => row['name'])).toEqual(['Acme', 'Acme Holding'])
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
			// THEN nothing is appended, since a company with no name cannot be worked
			// with or told apart from another
			expect(merged.added).toBe(0)
			expect(merged.findings).toBe(findings)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
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
			expect(mergePerFieldSearch(null, refreshed, SCAN).findings).toBe(null)
			expect(mergePerFieldSearch('x', refreshed, SCAN).findings).toBe('x')
		})

		it('should leave the findings alone when the second look holds no list', () => {
			// GIVEN a re-extraction that came back with nothing usable
			const findings = { prospects: [{ name: 'Acme' }] }
			// WHEN merged
			// THEN the list is untouched
			expect(mergePerFieldSearch(findings, {}, SCAN).findings).toBe(findings)
			expect(mergePerFieldSearch(findings, null, SCAN).findings).toBe(findings)
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
			const merged = mergePerFieldSearch(findings, refreshed, SCAN)
			// THEN everything beside the list survives the fold
			expect(
				(merged.findings as { pending_paid_actions: unknown })
					.pending_paid_actions,
			).toEqual([{ tool: 'lookup_registry' }])
		})
	})
})

describe('the fields each shape rescues', () => {
	it('should name the facts a profile and a scan are each worth searching for', () => {
		// GIVEN the two field lists the rescue works from
		// THEN a profile rescues its firmographics, and a scan rescues what makes a
		// company on a list reachable and worth reaching
		expect(HIGH_VALUE_FIELDS).toEqual([
			'country',
			'industry',
			'location',
			'size_range',
		])
		expect(SCAN_ROW_FIELDS).toEqual(['website', 'employee_estimate'])
	})
})
