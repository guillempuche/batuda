import { describe, expect, it } from 'vitest'

import { outcomeFromRun } from './eval-outcome'

describe('outcomeFromRun', () => {
	describe('when findings carry bare-string enrichment fields', () => {
		it('should read them into the scorable fields', () => {
			// GIVEN today's block-shaped findings
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport', country: 'ES' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the values come through
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.fields.country).toBe('ES')
		})
	})

	describe('when a scan removed organisations from its list', () => {
		it('should read them back off the finished run', () => {
			// GIVEN a stored run in the shape the pipeline actually writes: the
			//   removals live in the quality block, because they are gone from the
			//   list itself
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [{ name: 'Instalaciones Perez' }],
					quality: {
						not_companies: [
							{ name: 'Habitissimo', reason: 'quotes marketplace' },
							{ name: 'GeoTapp', reason: 'sells software to installers' },
						],
					},
				},
				fetchedUrls: [],
			})

			// THEN both come through with their reasons. Nothing else reading a
			//   finished run can see a removal happened, so a read that missed them
			//   would report every pass as having struck nobody off
			expect(outcome.removed).toEqual([
				{ name: 'Habitissimo', reason: 'quotes marketplace', describedAs: '' },
				{
					name: 'GeoTapp',
					reason: 'sells software to installers',
					describedAs: '',
				},
			])
		})

		it('should carry the row own words, which are what a judge must read', () => {
			// GIVEN a stored removal recording both the verdict and the row's own words
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [],
					quality: {
						not_companies: [
							{
								name: 'Cronoshare Fontaneros',
								reason: 'quotes marketplace',
								describedAs: 'Cronoshare marketing page mentions plumbing',
							},
						],
					},
				},
				fetchedUrls: [],
			})

			// THEN the words come through beside the reason. A second opinion shown
			//   the reason instead is being told the answer, and would agree with the
			//   check it exists to disagree with.
			expect(outcome.removed[0]?.describedAs).toBe(
				'Cronoshare marketing page mentions plumbing',
			)
			expect(outcome.removed[0]?.reason).toBe('quotes marketplace')
		})

		it('should report none for a run whose quality block holds no such list', () => {
			// GIVEN a run that removed nothing — and, the same case, one stored before
			//   a run recorded removals at all
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: { prospects: [{ name: 'Perez' }], quality: { rounds: 2 } },
				fetchedUrls: [],
			})

			// THEN none, rather than anything that would read as a fault
			expect(outcome.removed).toEqual([])
		})

		it('should ignore a removal carrying no name', () => {
			// GIVEN a malformed entry beside a good one
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [],
					quality: {
						not_companies: [
							{ reason: 'no name at all' },
							{ name: '  ', reason: 'blank' },
							{ name: 'Habitissimo', reason: 'quotes marketplace' },
						],
					},
				},
				fetchedUrls: [],
			})

			// THEN only the one that names an organisation counts: a nameless removal
			//   is nothing the judge could rule on, and counting it would inflate the
			//   figure it is weighed against
			expect(outcome.removed).toEqual([
				{ name: 'Habitissimo', reason: 'quotes marketplace', describedAs: '' },
			])
		})
	})

	describe('when a field is a per-field citation wrapper', () => {
		it('should read the inner value regardless of where its citation points', () => {
			// GIVEN a value that carries its own source — a third-party fact-source
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: {
					enrichment: {
						industry: {
							value: 'transport',
							source_id: 'https://en.wikipedia.org/wiki/Acme',
						},
					},
				},
				fetchedUrls: ['https://www.acme.es/about'],
			})

			// WHEN adapted — THEN the wrapper is unwrapped, and grounding comes from the
			// fetched official site, not the per-field citation (which is a third party)
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.reachedDomains).toEqual(['acme.es'])
		})
	})

	describe('when findings have no enrichment block', () => {
		it('should produce empty fields rather than throwing', () => {
			// GIVEN a failed run whose findings are just an error string
			const outcome = outcomeFromRun({
				status: 'no_reliable_data',
				findings: { error: 'nothing grounded' },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN no fields, and the status carries through
			expect(outcome.fields).toEqual({})
			expect(outcome.status).toBe('no_reliable_data')
		})
	})

	describe('when a non-terminal status slips through', () => {
		it('should treat it as a failed run', () => {
			// GIVEN a run still marked running (should not happen post-completion)
			const outcome = outcomeFromRun({
				status: 'running',
				findings: {},
				fetchedUrls: [],
			})

			// WHEN adapted — THEN it is normalized to failed
			expect(outcome.status).toBe('failed')
		})
	})

	describe('when a run succeeded with low confidence', () => {
		it('should keep the status instead of coercing it to failed', () => {
			// GIVEN a finished thin run with real findings
			const outcome = outcomeFromRun({
				status: 'succeeded_low_confidence',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the low-confidence success carries through
			expect(outcome.status).toBe('succeeded_low_confidence')
		})
	})

	describe('when the run fetched several pages', () => {
		it('should reach each host, stripping www and dropping unparseable URLs', () => {
			// GIVEN the run fetched the official site, a registry, and a bad URL
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [
					'https://www.acme.es/contact',
					'https://librebor.es/company/acme',
					'not a url',
				],
			})

			// WHEN adapted — THEN the reached hosts are normalized, the junk is gone
			expect(outcome.reachedDomains).toEqual(['acme.es', 'librebor.es'])
		})
	})

	describe('when the run fetched nothing', () => {
		it('should reach no domains', () => {
			// GIVEN a run that produced findings but has an empty fetch log
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN nothing grounds it
			expect(outcome.reachedDomains).toEqual([])
		})
	})

	describe('when the findings carry a size band', () => {
		it('should read it under the name the schema defines', () => {
			// GIVEN findings that include the size band
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: {
					enrichment: { industry: 'transport', size_range: '11-50' },
				},
				fetchedUrls: ['https://www.acme.es/about'],
			})

			// WHEN adapted — THEN the field resolves and the fetched page grounds it
			expect(outcome.fields.industry).toBe('transport')
			expect(outcome.fields.size_range).toBe('11-50')
			expect(outcome.reachedDomains).toEqual(['acme.es'])
		})
	})

	describe('when the pipeline confirmed the target in the official register', () => {
		it('should carry registryConfirmed through', () => {
			// GIVEN a run that fetched no site but stamped the registry-confirmation flag
			const outcome = outcomeFromRun({
				status: 'no_reliable_data',
				findings: { registry_confirmed: true, error: 'no site fetched' },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN it surfaces the reached-via-registry signal
			expect(outcome.registryConfirmed).toBe(true)
		})
	})

	describe('when no registry confirmation was recorded', () => {
		it('should leave registryConfirmed false', () => {
			// GIVEN findings without the flag
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the flag defaults false
			expect(outcome.registryConfirmed).toBe(false)
		})
	})

	describe('when a scan reported what it never went looking for', () => {
		it('should take the run’s own reckoning whole', () => {
			// GIVEN a finished scan whose stored block names two missing trades, one
			// of which nothing ever searched for, and says why the looking stopped
			const outcome = outcomeFromRun({
				status: 'succeeded_low_confidence',
				findings: {
					prospects: [],
					quality: {
						coverage: {
							covered: ['marbristas'],
							uncovered: ['ascensores', 'fontanería'],
							unsearched: ['ascensores'],
							thought_answered: ['ascensores'],
							stopped_because: 'answered',
						},
					},
				},
				fetchedUrls: [],
			})

			// THEN all three counts are read, including the one that says the trade
			// was lost after the search's last look rather than declined for room
			expect(outcome.reportedCoverage).toEqual({
				missing: 2,
				neverSearched: 1,
				thoughtAnswered: 1,
			})
		})
	})

	describe('when a scan said why it stopped looking', () => {
		it('should read the reason off the run', () => {
			// GIVEN a run stopped at its round cap
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: {
					prospects: [],
					quality: { searching_stopped: 'round_cap_reached' },
				},
				fetchedUrls: [],
			})

			// THEN the reason is carried through
			expect(outcome.searchingStopped).toBe('round_cap_reached')
		})

		it('should refuse a reason it cannot place', () => {
			// GIVEN a run stored by a later build, naming a reason this one has
			// never heard of
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { prospects: [], quality: { searching_stopped: 'gave_up' } },
				fetchedUrls: [],
			})

			// THEN nothing is carried: a word this build cannot place must not read
			// as a reason it can
			expect(outcome.searchingStopped).toBeNull()
		})

		it('should refuse a word every object already carries', () => {
			// GIVEN a run whose stored reason is the name every object answers to
			// rather than a reason
			const outcome = outcomeFromRun({
				status: 'succeeded',
				findings: { prospects: [], quality: { searching_stopped: 'toString' } },
				fetchedUrls: [],
			})

			// THEN it is refused like any other word this build cannot place
			expect(outcome.searchingStopped).toBeNull()
		})
	})

	describe('when a scan finished before these counts existed', () => {
		it('should report no reckoning rather than a clean one', () => {
			// GIVEN a block stored by an older run: it names what came back missing
			// but says nothing about what was looked for
			const outcome = outcomeFromRun({
				status: 'succeeded_low_confidence',
				findings: {
					prospects: [],
					quality: {
						coverage: {
							covered: ['marbristas'],
							uncovered: ['ascensores'],
						},
					},
				},
				fetchedUrls: [],
			})

			// THEN nothing is claimed. Reading the absent count as nought would make
			// every run finished before this change report a perfect record, which is
			// the one answer this figure must never invent
			expect(outcome.reportedCoverage).toBeNull()
		})
	})

	describe('when a run stored no coverage block at all', () => {
		it('should report no reckoning', () => {
			// GIVEN a run that answered with a profile, and one whose scan came back
			// empty and never reached the point where a block is written
			expect(
				outcomeFromRun({
					status: 'succeeded',
					findings: { enrichment: { industry: 'transport' } },
					fetchedUrls: [],
				}).reportedCoverage,
			).toBeNull()
			expect(
				outcomeFromRun({
					status: 'no_reliable_data',
					findings: { error: 'no results', reason: 'no_results' },
					fetchedUrls: [],
				}).reportedCoverage,
			).toBeNull()
		})
	})

	describe('when a run never came back at all', () => {
		it('should adapt it rather than throwing', () => {
			// GIVEN a run the poll gave up on, which reaches here with no findings —
			// the path a long market search ends on when it outlives its time limit
			const outcome = outcomeFromRun({
				status: 'failed',
				findings: null,
				fetchedUrls: [],
			})

			// WHEN adapted — THEN it scores as a failed run instead of ending the pass
			expect(outcome.status).toBe('failed')
			expect(outcome.contacts).toEqual([])
			expect(outcome.companies).toEqual([])
		})
	})

	describe('when the run answered with a list of companies', () => {
		it('should read the companies a scan found, and whether each has a site', () => {
			// GIVEN a prospect scan that came back with three companies, two of them
			// carrying a website
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [
						{ name: 'Acme', website: 'https://acme.test' },
						{ name: 'Beta', website: '   ' },
						{ name: 'Gamma', website: 'https://gamma.test' },
						{ website: 'https://nameless.test' },
					],
				},
				fetchedUrls: [],
			})

			// WHEN adapted
			// THEN the scan's own answer is visible to the scorer. Reading only the
			// profile block made every scan look like a run that found nothing, which
			// is why no scan could ever be measured
			expect(outcome.companies).toEqual([
				{
					name: 'Acme',
					website: 'https://acme.test',
					location: null,
					describedAs: '',
					confirmed: false,
				},
				{
					name: 'Beta',
					website: null,
					location: null,
					describedAs: '',
					confirmed: false,
				},
				{
					name: 'Gamma',
					website: 'https://gamma.test',
					location: null,
					describedAs: '',
					confirmed: false,
				},
			])
		})

		it('should read no companies when the run answers with a profile', () => {
			// GIVEN an enrichment run, whose answer is a profile rather than a list
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'company_enrichment_v1',
				findings: { enrichment: { industry: 'transport' } },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN there is no list to read, and the shape decides that
			expect(outcome.companies).toEqual([])
		})

		it('should measure profile fullness only on a shape that was given a profile', () => {
			// GIVEN the same findings read as a search and as a profile run
			const asScan = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: { prospects: [{ name: 'Alfa SL' }] },
				fetchedUrls: [],
			})
			const asProfile = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'company_enrichment_v1',
				findings: { enrichment: {} },
				fetchedUrls: [],
			})

			// WHEN adapted
			// THEN only the profile run carries one. A search is never given a profile,
			// so counting it reports every search as having filled none of a shape
			// nobody asked it for; a profile run that came back empty is a real nought
			// and still counts
			expect(asScan.profile).toBeUndefined()
			expect(asProfile.profile).toBeDefined()
			expect(asProfile.profile?.fieldsFilled).toBe(0)
		})

		it('should keep a row whose name arrives wrapped with its source', () => {
			// GIVEN a row whose name carries its citation, the shape a field takes once
			// citations travel per field
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: { prospects: [{ name: { value: 'Alfa SL' } }] },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the row is read rather than skipped for its shape
			expect(outcome.companies[0]?.name).toBe('Alfa SL')
		})
	})
})

describe('outcomeFromRun — what a scan row carries for the market figures', () => {
	describe('when a prospect row describes itself', () => {
		it('should carry every field the row says what it does in', () => {
			// GIVEN a prospect row filled the way the scan shape asks for it
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [
						{
							name: 'Instalaciones Alfa SL',
							website: 'https://alfa.example',
							industry: 'Instalaciones eléctricas',
							why_relevant: 'Instalador eléctrico industrial en Córdoba',
							location: 'Córdoba',
						},
					],
				},
				fetchedUrls: [],
			})

			// WHEN adapted
			// THEN the trade and the relevance note are run together. The note is read
			// even though it is where a row can repeat the request back, because it is
			// the only one of the three a prospect must fill — leaving it out silenced
			// every row that stated its trade nowhere else
			expect(outcome.companies).toEqual([
				{
					name: 'Instalaciones Alfa SL',
					website: 'https://alfa.example',
					location: 'Córdoba',
					describedAs:
						'Instalaciones eléctricas Instalador eléctrico industrial en Córdoba',
					confirmed: false,
				},
			])
		})
	})

	describe('when a competitor row describes itself', () => {
		it('should read the description that shape uses instead', () => {
			// GIVEN a competitor row, whose own words live under a different field name
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'competitor_scan_v1',
				findings: {
					competitors: [
						{ name: 'Beta SL', description: 'Ascensores y elevadores' },
					],
				},
				fetchedUrls: [],
			})

			// WHEN adapted — THEN it is read too, so neither shape goes unattributed to
			// the part of a request it answers for the want of a field name
			expect(outcome.companies[0]?.describedAs).toBe('Ascensores y elevadores')
		})
	})

	describe('when a row states a field but leaves it blank', () => {
		it('should read it as absent rather than as a value', () => {
			// GIVEN a row whose location and website are whitespace
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [{ name: 'Alfa SL', website: '  ', location: '\t' }],
				},
				fetchedUrls: [],
			})

			// WHEN adapted — THEN neither counts as stated, so a blank never inflates
			// the share of rows that say where the company is
			expect(outcome.companies[0]?.website).toBeNull()
			expect(outcome.companies[0]?.location).toBeNull()
		})
	})

	describe('when a field arrives wrapped with its source', () => {
		it('should read the value inside', () => {
			// GIVEN a location carried as a { value } wrapper, the shape a field takes
			// once its citation travels with it
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [{ name: 'Alfa SL', location: { value: 'Málaga' } }],
				},
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the adapter is indifferent to which shape produced it
			expect(outcome.companies[0]?.location).toBe('Málaga')
		})
	})

	describe('when a row describes itself in none of the three fields', () => {
		it('should leave its words empty rather than absent', () => {
			// GIVEN a row with a name and nothing else
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: { prospects: [{ name: 'Alfa SL' }] },
				fetchedUrls: [],
			})

			// WHEN adapted — THEN there is a string to search, holding nothing
			expect(outcome.companies[0]?.describedAs).toBe('')
		})
	})
})

describe('outcomeFromRun — whether a scan row was established', () => {
	describe('when a row carries a verdict', () => {
		it('should read a confirmed row as confirmed', () => {
			// GIVEN a scan whose rows were verified, one each way
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: {
					prospects: [
						{
							name: 'Acme',
							existence: { verdict: 'confirmed', websites: 2 },
						},
						{
							name: 'Beta',
							existence: {
								verdict: 'candidate',
								reason: 'one_website',
								websites: 1,
							},
						},
					],
				},
				fetchedUrls: [],
			})

			// WHEN adapted — THEN the verdict rides, so the recall cost of requiring
			// two independent sources can be counted
			expect(outcome.companies.map(row => row.confirmed)).toEqual([true, false])
		})
	})

	describe('when a row carries no verdict', () => {
		it('should read it as unconfirmed rather than as missing', () => {
			// GIVEN a run from before verification existed — every run in the
			// before-numbers
			const outcome = outcomeFromRun({
				status: 'succeeded',
				schemaName: 'prospect_scan_v1',
				findings: { prospects: [{ name: 'Acme' }] },
				fetchedUrls: [],
			})

			// WHEN adapted
			// THEN it reads a real nought rather than a blank, which is what makes
			// the before and after passes comparable
			expect(outcome.companies[0]?.confirmed).toBe(false)
		})
	})
})
