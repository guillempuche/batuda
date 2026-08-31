import { describe, expect, it } from 'vitest'

import { DISCOVERY_THIN_RESULT_COUNT } from './discovery-scan'
import { computeRunQuality } from './research-quality'

// Enough results that the thin-list signal stays quiet, so a test about some
// other signal is measuring only that one.
const FULL_LIST = DISCOVERY_THIN_RESULT_COUNT + 7

// A scan's input, with only the fields a test about removals cares about set.
const scanInput = {
	schemaName: 'prospect_scan_v1',
	entityMatch: null,
	rounds: 2,
	gapRounds: 0,
	sourcesTotal: 5,
	sourcesFirstParty: 0,
	ownDomainKnown: false,
	subjectUnreadable: false,
	fieldsGrounded: 0,
	fieldsTotal: 0,
	citationsSeen: 4,
	citationsKept: 4,
	scanResults: FULL_LIST,
	refined: false,
	coverage: null,
	searchStopped: null,
	coverageStopped: null,
	coverageLastMissing: [],
	existence: null,
} as const

describe('computeRunQuality', () => {
	describe('when a run reports what it took off its list', () => {
		it('should report only what the answer actually lacks', () => {
			// GIVEN the removals a run settled on, already held against the answer it
			//   hands back
			const quality = computeRunQuality({
				...scanInput,
				notCompanies: [
					{
						name: 'Habitissimo',
						reason: 'quotes marketplace',
						describedAs: '',
						websiteHost: 'habitissimo.es',
					},
					{
						name: 'SABEKO',
						reason: 'supplier to the trade',
						describedAs: '',
						websiteHost: '',
					},
				],
			})

			// THEN both are reported, because this block is given what the caller
			//   already settled against the answer. The settling itself is the
			//   caller's, and is covered where it happens.
			expect(quality.not_companies).toEqual([
				{
					name: 'Habitissimo',
					reason: 'quotes marketplace',
					describedAs: '',
					websiteHost: 'habitissimo.es',
				},
				{
					name: 'SABEKO',
					reason: 'supplier to the trade',
					describedAs: '',
					websiteHost: '',
				},
			])
		})

		it('should leave the key out entirely for a run that removed nothing', () => {
			// GIVEN a run that took nothing off its list
			const quality = computeRunQuality({ ...scanInput, notCompanies: [] })

			// THEN the key is absent rather than an empty list, so a reader cannot
			//   mistake "removed nothing" for "reported nothing about removals"
			expect('not_companies' in quality).toBe(false)
		})
	})

	describe('for an enrichment run', () => {
		const base = {
			schemaName: 'company_enrichment_v1',
			rounds: 6,
			gapRounds: 0,
			sourcesTotal: 5,
			sourcesFirstParty: 3,
			ownDomainKnown: true,
			subjectUnreadable: false,
			fieldsGrounded: 4,
			fieldsTotal: 6,
			notCompanies: [],
			citationsSeen: 4,
			citationsKept: 4,
			scanResults: null,
			refined: false,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should not flag a strong, well-grounded run', () => {
			// GIVEN the good run from the sample (6 rounds, strong match, own-domain sources)
			const quality = computeRunQuality({ ...base, entityMatch: 'strong' })
			// THEN it is trusted
			expect(quality.low_confidence).toBe(false)
			expect(quality.grounding_ratio).toBeCloseTo(0.67)
			expect(quality.sources_matched).toBe(3)
		})

		it('should flag a run whose entity match was downgraded', () => {
			// GIVEN a run where a field came from an off-entity source, so the match was
			// downgraded from strong to weak (the contamination case)
			const quality = computeRunQuality({ ...base, entityMatch: 'weak' })
			// THEN it is not safe to act on unreviewed
			expect(quality.low_confidence).toBe(true)
		})

		it('should not flag a strong run just for thin grounding', () => {
			// GIVEN a run that reached the right company (strong match) but filled little
			// of the profile — a thin-web company, not a bad run
			const quality = computeRunQuality({
				...base,
				entityMatch: 'strong',
				fieldsGrounded: 1,
				fieldsTotal: 6,
			})
			// THEN it stays trusted; the low grounding is reported in the block for a
			// caller that wants to gate on thinness itself
			expect(quality.low_confidence).toBe(false)
			expect(quality.grounding_ratio).toBeCloseTo(0.17)
		})

		it('should report no own-site pages as zero rather than leaving it out', () => {
			// GIVEN a run pinned to a company whose own site it never reached
			const quality = computeRunQuality({
				...base,
				entityMatch: 'weak',
				sourcesFirstParty: 0,
			})
			// THEN zero is what happened rather than "does not apply": this run had
			// a domain to hold its sources against and none of them was on it
			expect(quality.sources_matched).toBe(0)
		})

		it('should leave out the own-site count for a company with no site on record', () => {
			// GIVEN a run that clearly reached the company it was pinned to, but
			// whose website nobody has filled in — so there was no domain to hold a
			// source against
			const quality = computeRunQuality({
				...base,
				entityMatch: 'strong',
				sourcesFirstParty: 0,
				ownDomainKnown: false,
				subjectUnreadable: false,
			})
			// THEN it is left out: with no site anyone could have read, the count can
			// only ever be 0, exactly as on a search about no one company
			expect(quality.sources_matched).toBeUndefined()
		})

		it('should leave out the retry marker a run with no retry cannot have', () => {
			// GIVEN an enrichment run, which is never given the discovery retry
			const quality = computeRunQuality({ ...base, entityMatch: 'strong' })
			// THEN `refined` is absent rather than reported false on every run that
			// was never eligible for it
			expect(quality.refined).toBeUndefined()
		})
	})

	describe('for a discovery scan', () => {
		const scan = {
			entityMatch: null,
			rounds: 3,
			gapRounds: 0,
			sourcesTotal: 6,
			sourcesFirstParty: 0,
			ownDomainKnown: false,
			subjectUnreadable: false,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			notCompanies: [],
			citationsSeen: 10,
			citationsKept: 10,
			scanResults: FULL_LIST,
			refined: false,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should flag a scan vetted against a single source', () => {
			// GIVEN the bad scan from the sample: one search, one source
			const quality = computeRunQuality({
				...scan,
				schemaName: 'prospect_scan_v1',
				rounds: 1,
				sourcesTotal: 1,
			})
			// THEN it is low confidence
			expect(quality.low_confidence).toBe(true)
		})

		it('should not flag a scan vetted against several sources', () => {
			// GIVEN a scan that pulled from many sources and came back with a list
			const quality = computeRunQuality({
				...scan,
				schemaName: 'prospect_scan_v1',
			})
			// THEN it is trusted — this scan was pinned to no company, so there is
			// no entity verdict to weigh
			expect(quality.low_confidence).toBe(false)
		})

		it('should leave out the profile numbers a scan cannot have', () => {
			// GIVEN any scan, which fills no company profile
			const quality = computeRunQuality({
				...scan,
				schemaName: 'prospect_scan_v1',
			})
			// THEN the profile measures are absent rather than reported as zero, which
			// would read as a failing grade on every scan ever run
			expect(quality.grounding_ratio).toBeUndefined()
			expect(quality.fields_grounded).toBeUndefined()
		})

		it('should leave out the own-site count a search about nobody cannot have', () => {
			// GIVEN an open-ended search, which is about no one company
			const quality = computeRunQuality({
				...scan,
				schemaName: 'prospect_scan_v1',
			})
			// THEN there is no own domain to hold a source against, so the count is
			// absent rather than the 0 it could only ever read on such a search
			expect(quality.sources_matched).toBeUndefined()
		})

		it('should grade a competitor scan exactly as it grades a prospect scan', () => {
			// GIVEN the same thinly-vetted run under each scan schema
			const thinlyVetted = { ...scan, rounds: 1, sourcesTotal: 1 } as const
			const prospect = computeRunQuality({
				...thinlyVetted,
				schemaName: 'prospect_scan_v1',
			})
			const competitor = computeRunQuality({
				...thinlyVetted,
				schemaName: 'competitor_scan_v1',
			})

			// THEN the competitor scan is flagged like the prospect scan, and neither
			// reports a profile it never filled — the two are one kind of run as far
			// as grading goes, so neither escapes the single-source check the other
			// is held to, and neither is graded on a profile it was never asked for
			expect(competitor.low_confidence).toBe(prospect.low_confidence)
			expect(competitor.low_confidence).toBe(true)
			expect(competitor.grounding_ratio).toBeUndefined()
			expect(competitor.fields_grounded).toBeUndefined()
		})

		it('should report whether the refined retry fired', () => {
			// GIVEN two finished scans, one of which was given the refined retry
			const withRetry = computeRunQuality({
				...scan,
				schemaName: 'competitor_scan_v1',
				refined: true,
			})
			const withoutRetry = computeRunQuality({
				...scan,
				schemaName: 'competitor_scan_v1',
			})

			// THEN each says so on the run itself, so how much the retry is worth can
			// be read off finished runs rather than reconstructed from logs
			expect(withRetry.refined).toBe(true)
			expect(withoutRetry.refined).toBe(false)
		})
	})

	describe('when a scan came back with too few results', () => {
		const scan = {
			schemaName: 'prospect_scan_v1',
			entityMatch: null,
			rounds: 4,
			gapRounds: 0,
			sourcesTotal: 6,
			sourcesFirstParty: 0,
			ownDomainKnown: false,
			subjectUnreadable: false,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			notCompanies: [],
			citationsSeen: 10,
			citationsKept: 10,
			refined: true,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should flag a well-sourced scan that still found only a handful', () => {
			// GIVEN the reported run: four companies found, several sources read,
			// every citation kept — nothing else about it looks thin
			const quality = computeRunQuality({
				...scan,
				scanResults: DISCOVERY_THIN_RESULT_COUNT - 1,
			})

			// THEN it is marked for a read rather than reported as green as a run
			// that came back with forty
			expect(quality.low_confidence).toBe(true)
		})

		it('should flag a single result', () => {
			// GIVEN a scan that named one company
			const quality = computeRunQuality({ ...scan, scanResults: 1 })
			// THEN one result is not a list
			expect(quality.low_confidence).toBe(true)
		})

		it('should not flag a scan holding exactly the threshold', () => {
			// GIVEN a scan whose list is just long enough
			const quality = computeRunQuality({
				...scan,
				scanResults: DISCOVERY_THIN_RESULT_COUNT,
			})
			// THEN the threshold is where a list stops being thin, so it stays trusted
			expect(quality.low_confidence).toBe(false)
		})

		it('should never raise the signal for a run that was asked for no list', () => {
			// GIVEN an enrichment run, which reports no scan list at all
			const quality = computeRunQuality({
				schemaName: 'company_enrichment_v1',
				entityMatch: 'strong',
				rounds: 6,
				gapRounds: 0,
				sourcesTotal: 5,
				sourcesFirstParty: 3,
				ownDomainKnown: true,
				subjectUnreadable: false,
				fieldsGrounded: 4,
				fieldsTotal: 6,
				notCompanies: [],
				citationsSeen: 4,
				citationsKept: 4,
				scanResults: null,
				refined: false,
				coverage: null,
				searchStopped: null,
				coverageStopped: null,
				coverageLastMissing: [],
				existence: null,
			})
			// THEN the thin-list signal stays quiet — a missing list is "does not
			// apply", not "found nothing"
			expect(quality.low_confidence).toBe(false)
		})
	})

	describe('when a scan answered only some of what it was asked', () => {
		// A scan nothing else finds fault with: plenty of sources, every citation
		// kept, a long list. The only thing that can move the flag here is coverage.
		const healthyScan = {
			schemaName: 'prospect_scan_v1',
			entityMatch: null,
			rounds: 5,
			gapRounds: 2,
			sourcesTotal: 131,
			sourcesFirstParty: 0,
			ownDomainKnown: false,
			subjectUnreadable: false,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			notCompanies: [],
			citationsSeen: 60,
			citationsKept: 60,
			scanResults: 62,
			refined: false,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should flag a long list that answered one of the trades asked about', () => {
			// GIVEN the reported run: 62 companies, four of the five trades the
			// request named with nobody in them
			const quality = computeRunQuality({
				...healthyScan,
				coverage: {
					covered: ['instalaciones eléctricas'],
					uncovered: ['fontanería', 'solar', 'incendios', 'ascensores'],
					unsearched: [],
				},
			})
			// THEN it is marked for a read: 62 is not thin and nothing else here is
			// wrong, so without this the run reports plain success over a fifth of
			// the question
			expect(quality.low_confidence).toBe(true)
		})

		it('should report which parts came back and which did not', () => {
			// GIVEN the same run
			const quality = computeRunQuality({
				...healthyScan,
				coverage: {
					covered: ['instalaciones eléctricas'],
					uncovered: ['ascensores'],
					unsearched: [],
				},
			})
			// THEN the shortfall can be read off the finished run rather than by
			// searching again to find out what is missing
			expect(quality.coverage).toEqual({
				covered: ['instalaciones eléctricas'],
				uncovered: ['ascensores'],
				unsearched: [],
				thought_answered: [],
				stopped_because: null,
			})
		})

		it('should say why the looking stopped, so the two causes read apart', () => {
			// GIVEN two runs missing the same trade and naming it unsearched — one
			// that had nothing left to chase, one the clock stopped
			const drifted = computeRunQuality({
				...healthyScan,
				coverage: {
					covered: ['instalaciones eléctricas'],
					uncovered: ['ascensores'],
					unsearched: ['ascensores'],
				},
				coverageStopped: 'answered',
			})
			const ranOut = computeRunQuality({
				...healthyScan,
				coverage: {
					covered: ['instalaciones eléctricas'],
					uncovered: ['ascensores'],
					unsearched: ['ascensores'],
				},
				coverageStopped: 'deadline_margin',
			})
			// THEN the blocks are identical but for the reason, which is the only
			// thing saying whether the trade was lost between two readings or the
			// run simply ran out of room to look
			expect(drifted.coverage?.stopped_because).toBe('answered')
			expect(ranOut.coverage?.stopped_because).toBe('deadline_margin')
			expect(drifted.coverage?.unsearched).toEqual(ranOut.coverage?.unsearched)
		})

		it('should carry the parts nothing ever looked for through to the block', () => {
			// GIVEN a run whose only shortfall is a trade no pass was ever spent on
			const quality = computeRunQuality({
				...healthyScan,
				coverage: {
					covered: ['instalaciones eléctricas'],
					uncovered: ['ascensores'],
					unsearched: ['ascensores'],
				},
			})
			// THEN it is still marked for a read — the list does not answer the
			// request either way — and the block says the trade was never searched
			// for, so the gap is not read as a market with nobody in it
			expect(quality.low_confidence).toBe(true)
			expect(quality.coverage?.unsearched).toEqual(['ascensores'])
		})

		it('should stay trusted when every part came back with companies', () => {
			// GIVEN a scan that answered all three trades
			const quality = computeRunQuality({
				...healthyScan,
				coverage: {
					covered: ['instalaciones eléctricas', 'fontanería', 'ascensores'],
					uncovered: [],
					unsearched: [],
				},
			})
			// THEN nothing is raised, and the covered list is still reported so a
			// reader can see what "answered" meant
			expect(quality.low_confidence).toBe(false)
			expect(quality.coverage?.uncovered).toEqual([])
		})

		it('should leave coverage out where the question does not arise', () => {
			// GIVEN a run that never had a list of parts to work through — every run
			// that is not a scan, and a request naming one kind of company
			const quality = computeRunQuality(healthyScan)
			// THEN nothing is reported about coverage: an empty block would read as
			// having covered none of it, which is a failing grade for a question
			// nobody asked
			expect(quality.coverage).toBeUndefined()
			expect(quality.low_confidence).toBe(false)
		})
	})

	describe('when the citation guard weighed what a run cited', () => {
		const scanBase = {
			schemaName: 'prospect_scan_v1',
			entityMatch: null,
			rounds: 5,
			gapRounds: 0,
			sourcesTotal: 2,
			sourcesFirstParty: 0,
			ownDomainKnown: false,
			subjectUnreadable: false,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			scanResults: FULL_LIST,
			refined: false,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should flag a run whose citations were all rejected', () => {
			// GIVEN a scan that offered 31 citations and had every one rejected as
			// pointing at a page it never reached
			const quality = computeRunQuality({
				...scanBase,
				notCompanies: [],
				citationsSeen: 31,
				citationsKept: 0,
			})
			// THEN nothing stands behind the findings, so they are not safe to act
			// on unread
			expect(quality.low_confidence).toBe(true)
			expect(quality.citations_seen).toBe(31)
			expect(quality.citations_kept).toBe(0)
		})

		it('should not flag a run that cited nothing at all', () => {
			// GIVEN a scan that offered no citations, so the guard rejected none
			const quality = computeRunQuality({
				...scanBase,
				notCompanies: [],
				citationsSeen: 0,
				citationsKept: 0,
			})
			// THEN this signal stays quiet — citing nothing is a different shortfall,
			// and the source and entity checks are what judge it
			expect(quality.low_confidence).toBe(false)
		})

		it('should not flag a run that kept even one citation', () => {
			// GIVEN a scan where most citations were rejected but one resolved
			const quality = computeRunQuality({
				...scanBase,
				notCompanies: [],
				citationsSeen: 12,
				citationsKept: 1,
			})
			// THEN it is not flagged by this signal: the run did reach a page it cited
			expect(quality.low_confidence).toBe(false)
		})
	})

	describe('for a scan launched from one company', () => {
		const anchoredScan = (entityMatch: 'strong' | 'weak' | 'absent'): boolean =>
			computeRunQuality({
				schemaName: 'prospect_scan_v1',
				entityMatch,
				rounds: 3,
				gapRounds: 0,
				sourcesTotal: 6,
				sourcesFirstParty: 2,
				ownDomainKnown: true,
				subjectUnreadable: false,
				fieldsGrounded: 0,
				fieldsTotal: 0,
				notCompanies: [],
				citationsSeen: 8,
				citationsKept: 8,
				scanResults: FULL_LIST,
				refined: false,
				coverage: null,
				searchStopped: null,
				coverageStopped: null,
				coverageLastMissing: [],
				existence: null,
			}).low_confidence

		it('should flag one that never clearly reached that company', () => {
			// GIVEN a scan pinned to a company, vetted against plenty of sources, but
			// whose evidence only glances at the company it was launched from —
			// everything it found is a list built off the wrong starting point
			// THEN it is marked for review however many sources it read
			expect(anchoredScan('weak')).toBe(true)
			expect(anchoredScan('absent')).toBe(true)
		})

		it('should trust one that clearly reached it', () => {
			// GIVEN the same scan, this time clearly about the right company
			expect(anchoredScan('strong')).toBe(false)
		})

		it('should keep its own-site count even when the evidence missed it', () => {
			// GIVEN a scan pinned to a company, two of whose own pages it did reach,
			// but whose evidence never clearly landed on that company
			const quality = computeRunQuality({
				schemaName: 'prospect_scan_v1',
				entityMatch: 'absent',
				rounds: 3,
				gapRounds: 0,
				sourcesTotal: 6,
				sourcesFirstParty: 2,
				ownDomainKnown: true,
				subjectUnreadable: false,
				fieldsGrounded: 0,
				fieldsTotal: 0,
				notCompanies: [],
				citationsSeen: 8,
				citationsKept: 8,
				scanResults: FULL_LIST,
				refined: false,
				coverage: null,
				searchStopped: null,
				coverageStopped: null,
				coverageLastMissing: [],
				existence: null,
			})
			// THEN the count still stands: 'absent' is a verdict on what the evidence
			// showed, not the run having no company to be about
			expect(quality.sources_matched).toBe(2)
		})
	})

	describe('for a run that was asked for no company profile', () => {
		// Every schema but an enrichment arrives with 0 of 0 profile fields.
		const noProfile = {
			entityMatch: null,
			rounds: 2,
			gapRounds: 0,
			sourcesTotal: 4,
			sourcesFirstParty: 0,
			ownDomainKnown: false,
			subjectUnreadable: false,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			notCompanies: [],
			citationsSeen: 3,
			citationsKept: 3,
			scanResults: null,
			refined: false,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should leave out the profile numbers a brief never fills', () => {
			// GIVEN a brief, which writes prose and fills no profile at all
			const quality = computeRunQuality({
				...noProfile,
				schemaName: 'freeform',
			})
			// THEN neither is reported: with no fields to fill, a 0 would grade the
			// run for work it was never asked to do
			expect(quality.fields_grounded).toBeUndefined()
			expect(quality.grounding_ratio).toBeUndefined()
		})

		it('should leave out the profile numbers a hunt for contacts never fills', () => {
			// GIVEN a contact search, which comes back with people rather than a
			// filled-in company profile
			const quality = computeRunQuality({
				...noProfile,
				schemaName: 'contact_discovery_v1',
			})
			// THEN the same holds: what leaves the numbers meaningless is the missing
			// profile, not which kind of run went looking
			expect(quality.fields_grounded).toBeUndefined()
			expect(quality.grounding_ratio).toBeUndefined()
		})

		it('should leave out the own-site count as an open-ended search does', () => {
			// GIVEN a brief, which is pinned to no company and asked for no list
			const quality = computeRunQuality({
				...noProfile,
				schemaName: 'freeform',
			})
			// THEN it is left out here too: a brief has no company to hold a source
			// against, as squarely as an open-ended search has none
			expect(quality.sources_matched).toBeUndefined()
		})

		it('should keep the retry marker on a scan that fills no profile', () => {
			// GIVEN a scan, which fills no profile either but was given the refined
			// retry
			const quality = computeRunQuality({
				...noProfile,
				schemaName: 'prospect_scan_v1',
				scanResults: FULL_LIST,
				refined: true,
			})
			// THEN the marker still stands: it says whether the scan went back for
			// more, which has nothing to do with a profile
			expect(quality.refined).toBe(true)
			expect(quality.fields_grounded).toBeUndefined()
		})
	})

	describe('when a run gathered and then went back for what was missing', () => {
		const searchRun = {
			schemaName: 'prospect_scan_v1',
			entityMatch: null,
			sourcesTotal: 131,
			sourcesFirstParty: 0,
			ownDomainKnown: false,
			subjectUnreadable: false,
			fieldsGrounded: 0,
			fieldsTotal: 0,
			notCompanies: [],
			citationsSeen: 60,
			citationsKept: 60,
			scanResults: FULL_LIST,
			refined: true,
			coverage: null,
			searchStopped: null,
			coverageStopped: null,
			coverageLastMissing: [],
			existence: null,
		} as const

		it('should report each phase of rounds as its own number', () => {
			// GIVEN the reported run: three gathering rounds, then four more spent
			// closing the gaps the first extraction left
			const quality = computeRunQuality({
				...searchRun,
				rounds: 3,
				gapRounds: 4,
			})
			// THEN each phase keeps its own count: the run did seven rounds of work
			// across two phases, and no single number says that
			expect(quality.rounds).toBe(3)
			expect(quality.gap_rounds).toBe(4)
		})

		it('should report zero gap rounds rather than leaving them out', () => {
			// GIVEN an enrichment whose first extraction left nothing to go back for
			const quality = computeRunQuality({
				schemaName: 'company_enrichment_v1',
				entityMatch: 'strong',
				rounds: 6,
				gapRounds: 0,
				sourcesTotal: 5,
				sourcesFirstParty: 3,
				ownDomainKnown: true,
				subjectUnreadable: false,
				fieldsGrounded: 6,
				fieldsTotal: 6,
				notCompanies: [],
				citationsSeen: 4,
				citationsKept: 4,
				scanResults: null,
				refined: false,
				coverage: null,
				searchStopped: null,
				coverageStopped: null,
				coverageLastMissing: [],
				existence: null,
			})
			// THEN zero is reported rather than left out: a run that went back for
			// nothing is a run that needed nothing, which is worth knowing
			expect(quality.gap_rounds).toBe(0)
		})

		it('should report both as zero for a run resumed from finished work', () => {
			// GIVEN a run resumed from a checkpoint that already held its findings, so
			// it neither gathered nor went back for anything this time
			const quality = computeRunQuality({
				...searchRun,
				rounds: 0,
				gapRounds: 0,
			})
			// THEN both read zero for this attempt — the earlier attempt's rounds
			// belong to that attempt, and the run's own step count carries them over
			expect(quality.rounds).toBe(0)
			expect(quality.gap_rounds).toBe(0)
		})

		it('should not let either round count sway the confidence flag', () => {
			// GIVEN the same run counted as having done no rounds at all and as
			// having gathered and gone back many times over
			const none = computeRunQuality({
				...searchRun,
				rounds: 0,
				gapRounds: 0,
			})
			const many = computeRunQuality({
				...searchRun,
				rounds: 6,
				gapRounds: 4,
			})
			// THEN both read the same: the counts are there to be read, and how many
			// rounds a run took says nothing about whether its answer is thin
			expect(many.low_confidence).toBe(none.low_confidence)
			expect(many.low_confidence).toBe(false)
		})
	})
})

describe('computeRunQuality — how the list split', () => {
	const scan = {
		schemaName: 'prospect_scan_v1',
		entityMatch: null,
		rounds: 3,
		gapRounds: 1,
		sourcesTotal: 8,
		sourcesFirstParty: 0,
		ownDomainKnown: false,
		subjectUnreadable: false,
		fieldsGrounded: 0,
		fieldsTotal: 0,
		notCompanies: [],
		citationsSeen: 20,
		citationsKept: 20,
		scanResults: FULL_LIST,
		refined: false,
		coverage: null,
		searchStopped: null,
		coverageStopped: null,
		coverageLastMissing: [],
	} as const

	describe('when a scan verified its list', () => {
		it('should report both counts', () => {
			// GIVEN a list that split into four confirmed and eight candidates
			const quality = computeRunQuality({
				...scan,
				existence: { confirmed: 4, candidates: 8 },
			})

			// THEN a reader can see what the run stands behind without opening it
			expect(quality.existence).toEqual({ confirmed: 4, candidates: 8 })
		})

		it('should not flag a run for coming back mostly candidates', () => {
			// GIVEN a list where nothing at all could be confirmed
			const quality = computeRunQuality({
				...scan,
				existence: { confirmed: 0, candidates: 12 },
			})

			// THEN the run is reported, not flagged. What to do about a list of
			// candidates is a decision about that list; making it the run-level flag
			// would put every honest scan behind a review step before there is any
			// measurement of how often that happens
			expect(quality.low_confidence).toBe(false)
		})
	})

	describe('when the run had no list to split', () => {
		it('should leave the block out rather than reporting nought', () => {
			// GIVEN a run that was never asked for companies
			const quality = computeRunQuality({ ...scan, existence: null })

			// THEN the question does not arise, which is not the same answer as
			// "it confirmed none"
			expect('existence' in quality).toBe(false)
		})
	})
})

describe('computeRunQuality — when the run could not read its own subject', () => {
	// An enrichment run that went well by every other measure: rounds, sources,
	// citations, a full profile. The only thing wrong with it is that nobody ever
	// checked the pages were this company's.
	const healthy = {
		schemaName: 'company_enrichment_v1',
		entityMatch: null,
		rounds: 6,
		gapRounds: 1,
		sourcesTotal: 5,
		sourcesFirstParty: 0,
		ownDomainKnown: false,
		subjectUnreadable: false,
		fieldsGrounded: 5,
		fieldsTotal: 6,
		notCompanies: [],
		citationsSeen: 4,
		citationsKept: 4,
		scanResults: null,
		refined: false,
		coverage: null,
		searchStopped: null,
		coverageStopped: null,
		coverageLastMissing: [],
		existence: null,
	} as const

	describe('when the subject name yielded no key', () => {
		it('should refuse the run a clean finish', () => {
			// GIVEN a run that is thin in no other way
			const quality = computeRunQuality({ ...healthy, subjectUnreadable: true })
			// THEN it cannot come back as a clean success: every check that asks
			// whether these pages are this company's was skipped
			expect(quality.low_confidence).toBe(true)
		})

		it("should state the reason in the run's own answer", () => {
			// GIVEN the same run
			const quality = computeRunQuality({ ...healthy, subjectUnreadable: true })
			// THEN a person reading the result is told why, rather than having to
			// find it in the logs
			expect(quality.subject_unreadable).toBe(true)
		})

		it('should say it of a scan pinned to such a company too', () => {
			// GIVEN an anchored scan whose list is long and well vetted
			const quality = computeRunQuality({
				...healthy,
				schemaName: 'prospect_scan_v1',
				scanResults: FULL_LIST,
				fieldsGrounded: 0,
				fieldsTotal: 0,
				subjectUnreadable: true,
			})
			// THEN it is flagged as well — a scan built from a company nobody
			// checked is no safer to act on unread than a profile of one
			expect(quality.low_confidence).toBe(true)
			expect(quality.subject_unreadable).toBe(true)
		})
	})

	describe('when the subject was read', () => {
		it('should leave the reason out rather than report it false', () => {
			// GIVEN a run whose subject name yielded keys
			const quality = computeRunQuality({
				...healthy,
				entityMatch: 'strong',
			})
			// THEN the question does not arise, so nothing is said — its presence
			// is the whole signal, and is what makes the count meaningful
			expect('subject_unreadable' in quality).toBe(false)
			expect(quality.low_confidence).toBe(false)
		})

		it('should stay quiet on a run that is flagged for some other reason', () => {
			// GIVEN a readable subject the evidence only glancingly mentioned
			const quality = computeRunQuality({
				...healthy,
				entityMatch: 'weak',
			})
			// THEN the run is flagged, but not for a reason that did not happen
			expect(quality.low_confidence).toBe(true)
			expect('subject_unreadable' in quality).toBe(false)
		})
	})

	describe('when the run was about nobody in particular', () => {
		it('should say nothing, since there was no subject to read', () => {
			// GIVEN an open scan, pinned to no company
			const quality = computeRunQuality({
				...healthy,
				schemaName: 'prospect_scan_v1',
				scanResults: FULL_LIST,
				fieldsGrounded: 0,
				fieldsTotal: 0,
			})
			// THEN the checks had nothing to check, which costs nothing and is not
			// this reason
			expect('subject_unreadable' in quality).toBe(false)
			expect(quality.low_confidence).toBe(false)
		})
	})
})

describe('computeRunQuality — saying why the searching stopped', () => {
	const scan = { ...scanInput, notCompanies: [] } as const
	// A thin list is the case this signal exists for: a market that holds only
	// this many companies and a search stopped after this many look identical
	// from the outside.
	const thinScan = {
		...scan,
		scanResults: DISCOVERY_THIN_RESULT_COUNT - 3,
	} as const

	describe('when the search ran out of things it wanted to do', () => {
		it('should say it finished looking', () => {
			// GIVEN a scan whose model stopped calling tools of its own accord
			const quality = computeRunQuality({
				...thinScan,
				searchStopped: 'model-final',
			})

			// THEN the short list is the search's own answer about this market,
			// and the run says so
			expect(quality.searching_stopped).toBe('finished_looking')
		})
	})

	describe('when the search was stopped with more it would have done', () => {
		it('should name the round cap', () => {
			// GIVEN a scan whose gathering ran to its last permitted round
			const quality = computeRunQuality({
				...thinScan,
				searchStopped: 'step-cap',
			})

			// THEN the short list is where the run was cut off, not what the market
			// holds — so the reader can tell the two apart and run it again
			expect(quality.searching_stopped).toBe('round_cap_reached')
		})

		it('should name the money running out', () => {
			// GIVEN a scan that could no longer afford a round
			const quality = computeRunQuality({
				...thinScan,
				searchStopped: 'budget',
			})

			// THEN what stopped it is named rather than left as a short list
			expect(quality.searching_stopped).toBe('budget_exhausted')
		})

		it('should name the prompt outgrowing its window', () => {
			// GIVEN a scan whose accumulated prompt reached the context ceiling
			const quality = computeRunQuality({
				...thinScan,
				searchStopped: 'context',
			})

			// THEN that ceiling is named too: it is a limit on the run, not on the
			// market
			expect(quality.searching_stopped).toBe('context_full')
		})
	})

	describe('when the request named a single kind of company', () => {
		it('should still say why the searching stopped', () => {
			// GIVEN a scan with no coverage reading at all — one kind of company
			// asked for, so there is no list of parts to hold it to
			const quality = computeRunQuality({
				...thinScan,
				coverage: null,
				searchStopped: 'step-cap',
			})

			// THEN the run still answers whether it had finished looking. This is
			// the case the coverage block cannot reach and the one a thin list is
			// most often judged on
			expect('coverage' in quality).toBe(false)
			expect(quality.searching_stopped).toBe('round_cap_reached')
		})
	})

	describe('when the scan came back with nothing at all', () => {
		it('should still say why the searching stopped', () => {
			// GIVEN a scan that hands back an empty list
			const quality = computeRunQuality({
				...scan,
				scanResults: 0,
				searchStopped: 'budget',
			})

			// THEN an empty answer is exactly where the reason matters: nothing
			// found because the money ran out is not nothing found in this market
			expect(quality.searching_stopped).toBe('budget_exhausted')
		})
	})

	describe('when the run never searched', () => {
		it('should leave the reason out rather than claim it finished', () => {
			// GIVEN a resume that reuses an earlier attempt and gathers nothing
			const quality = computeRunQuality({ ...scan, searchStopped: null })

			// THEN there is no answer to give, and reporting one would say this
			// run had looked
			expect('searching_stopped' in quality).toBe(false)
		})
	})

	describe('when the run fills one company profile', () => {
		it('should leave the reason out', () => {
			// GIVEN an enrichment, which reports fields rather than a list
			const quality = computeRunQuality({
				...scan,
				schemaName: 'company_enrichment_v1',
				scanResults: null,
				searchStopped: 'step-cap',
			})

			// THEN how far the searching got is not what a reader of that run
			// weighs, so it is left out rather than reported as a shortfall
			expect('searching_stopped' in quality).toBe(false)
		})
	})

	describe('when a search was stopped but came back with a full list', () => {
		it('should report the reason without marking the run for a read', () => {
			// GIVEN a scan cut off at the round cap that still returned a full list
			const quality = computeRunQuality({
				...scan,
				scanResults: FULL_LIST,
				searchStopped: 'step-cap',
			})

			// THEN it is reported, never gated on: what to do about a search that was
			// cut off is the reader's decision, so the run is not marked for a read
			expect(quality.searching_stopped).toBe('round_cap_reached')
			expect(quality.low_confidence).toBe(false)
		})
	})
})
