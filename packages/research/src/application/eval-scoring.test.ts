import { describe, expect, it } from 'vitest'

import {
	type GoldenExpectation,
	groupSummaries,
	type RunOutcome,
	type RunScore,
	scoreRun,
	summarizeScores,
} from './eval-scoring'

const acme: GoldenExpectation = {
	id: 'acme',
	query: 'Acme Logistics, Barcelona',
	officialDomain: 'acme.es',
	fields: {
		industry: 'transport',
		country: 'ES',
		size_range: '11-50',
	},
}

const outcome = (over: Partial<RunOutcome>): RunOutcome => ({
	status: 'succeeded',
	reachedDomains: ['acme.es'],
	fields: {},
	contacts: [],
	...over,
})

describe('scoreRun', () => {
	describe('when the run grounded on the official domain', () => {
		it('should mark it grounded and not wrong-company', () => {
			// GIVEN a run that read the target's own site and filled a field
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: ['https://www.acme.es/about'],
					fields: { industry: 'transport' },
				}),
			)

			// WHEN scored — THEN it reached the target
			expect(result.grounded).toBe(true)
			expect(result.wrongCompany).toBe(false)
			expect(result.empty).toBe(false)
		})
	})

	describe('when the run grounded only on an alt domain', () => {
		it('should still count as reaching the target', () => {
			// GIVEN a registry profile listed as an accepted grounding anchor
			const withAlt: GoldenExpectation = {
				...acme,
				altDomains: ['librebor.es'],
			}

			// WHEN the run grounded on that alt domain only
			const result = scoreRun(
				withAlt,
				outcome({
					reachedDomains: ['librebor.es'],
					fields: { country: 'ES' },
				}),
			)

			// THEN grounding is satisfied
			expect(result.grounded).toBe(true)
		})
	})

	describe('when the run reached a subdomain of the official site', () => {
		it('should still count as reaching the target', () => {
			// GIVEN a run that fetched a careers subdomain, not the apex domain
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: ['careers.acme.es'],
					fields: { industry: 'transport' },
				}),
			)

			// THEN a subdomain of the official site still grounds it
			expect(result.grounded).toBe(true)
			expect(result.wrongCompany).toBe(false)
		})
	})

	describe('when a registry lookup confirmed the target but no page was reached', () => {
		it('should count as grounded and not wrong-company', () => {
			// GIVEN a run that fetched no page but resolved the company in the register
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: [],
					registryConfirmed: true,
					fields: { country: 'ES' },
				}),
			)

			// WHEN scored — THEN the registry confirmation grounds it; not a look-alike
			expect(result.grounded).toBe(true)
			expect(result.wrongCompany).toBe(false)
		})
	})

	describe('when a succeeded run returned data but never reached the target', () => {
		it('should flag it as wrong-company', () => {
			// GIVEN a confident run whose sources are a same-named different company
			const result = scoreRun(
				acme,
				outcome({
					reachedDomains: ['ceva-logistics.com'],
					fields: { industry: 'transport' },
				}),
			)

			// WHEN scored — THEN it is the look-alike failure
			expect(result.grounded).toBe(false)
			expect(result.wrongCompany).toBe(true)
			expect(result.empty).toBe(false)
		})
	})

	describe('when an ungrounded run returned the known-correct company', () => {
		it('should not flag wrong-company when it recovered a known person', () => {
			// GIVEN a run that never reached the official site but returned a golden
			// contact by name (identity proof) from a third-party page
			const withContact: GoldenExpectation = {
				...acme,
				contacts: [{ name: 'Andrew Smith' }],
			}
			const result = scoreRun(
				withContact,
				outcome({
					reachedDomains: ['en.wikipedia.org'],
					fields: { industry: 'transport' },
					contacts: [{ name: 'Andrew Smith', role: 'CEO' }],
				}),
			)

			// THEN a matched known person proves it found the right company
			expect(result.grounded).toBe(false)
			expect(result.wrongCompany).toBe(false)
		})

		it('should not flag wrong-company on a specific (non-megacity) location match', () => {
			// GIVEN a small-town golden and an ungrounded run that matched the town
			const inAlcover: GoldenExpectation = {
				...acme,
				fields: { location: 'Alcover' },
			}
			const result = scoreRun(
				inAlcover,
				outcome({
					reachedDomains: ['datoscif.es'],
					fields: { location: 'Alcover, Tarragona, Spain' },
				}),
			)

			// THEN a distinctive place identifies the company even off its own site
			expect(result.grounded).toBe(false)
			expect(result.wrongCompany).toBe(false)
		})

		it('should still flag wrong-company for a generic-city match with no contact', () => {
			// GIVEN a megacity golden with no known contacts, and an ungrounded run
			const inLondon: GoldenExpectation = {
				...acme,
				fields: { location: 'London' },
			}
			const result = scoreRun(
				inLondon,
				outcome({
					reachedDomains: ['doordash.com'],
					fields: { location: 'London, United Kingdom' },
				}),
			)

			// THEN a global capital is too generic to confirm identity: still flagged
			expect(result.wrongCompany).toBe(true)
		})

		it('should still flag wrong-company when a specific location does not match', () => {
			// GIVEN a small-town golden and an ungrounded run reporting a different town
			const inAlcover: GoldenExpectation = {
				...acme,
				fields: { location: 'Alcover' },
			}
			const result = scoreRun(
				inAlcover,
				outcome({
					reachedDomains: ['some-directory.com'],
					fields: { location: 'Valencia' },
				}),
			)

			// THEN mismatched data is still the look-alike failure
			expect(result.wrongCompany).toBe(true)
		})
	})

	describe('when the run failed to confirm the company', () => {
		it('should be empty and never wrong-company', () => {
			// GIVEN a run that failed closed with no fields
			const result = scoreRun(
				acme,
				outcome({
					status: 'no_reliable_data',
					reachedDomains: [],
					fields: {},
				}),
			)

			// WHEN scored — THEN empty, and a failed run is not "wrong company"
			expect(result.empty).toBe(true)
			expect(result.wrongCompany).toBe(false)
		})
	})

	describe('when a run succeeded only with low confidence', () => {
		it('should still score its findings rather than reading as empty', () => {
			// GIVEN a thin-but-real success that filled a field
			const result = scoreRun(
				acme,
				outcome({
					status: 'succeeded_low_confidence',
					reachedDomains: ['https://www.acme.es/about'],
					fields: { industry: 'transport' },
				}),
			)

			// WHEN scored — THEN it counts as a success with data, not an empty run
			expect(result.empty).toBe(false)
			expect(result.grounded).toBe(true)
		})
	})

	describe('when a succeeded run filled no scorable field', () => {
		it('should count as empty', () => {
			// GIVEN a run that succeeded but produced only blanks
			const result = scoreRun(
				acme,
				outcome({ fields: { industry: '  ', country: null } }),
			)

			// WHEN scored — THEN there is no usable data
			expect(result.empty).toBe(true)
		})
	})

	describe('when scoring the trade a run named', () => {
		const withIndustry = (expected: string, actual: string): RunScore =>
			scoreRun(
				{ ...acme, fields: { industry: expected } },
				outcome({ fields: { industry: actual } }),
			)

		it('should count a longer naming of the same trade as correct', () => {
			// GIVEN a golden naming the trade and a run that read it off a page,
			// where the page says more than the golden does
			// WHEN the golden's words are all in what was read
			// THEN it is the same trade, so the field counts as correct
			expect(
				withIndustry(
					'Bicycle manufacturing',
					'Bicycle manufacturing and repair',
				).fieldsCorrect,
			).toBe(1)
		})

		it('should read two spellings of one trade as one trade', () => {
			// GIVEN the same trade written with and without its accents, and with
			// the Catalan l·l spelled out
			// WHEN scored — THEN the spelling difference does not cost a point,
			// because the CRM would file both on one entry too
			expect(withIndustry('Metal·lúrgia', 'metallurgia').fieldsCorrect).toBe(1)
			expect(
				withIndustry('Fusteria d’alumini', "fusteria d'alumini").fieldsCorrect,
			).toBe(1)
		})

		it('should forgive an ending on the same word', () => {
			// GIVEN a golden in the singular and a page that wrote the plural
			// WHEN the two share a stem — THEN they are the same trade
			expect(withIndustry('Fusteria', 'Fusteries Roca').fieldsCorrect).toBe(1)
			expect(
				withIndustry('manufacturing', 'Bike Manufacturer Ltd').fieldsCorrect,
			).toBe(1)
		})

		it('should score a trade written in a non-Latin script', () => {
			// GIVEN a trade named in Cyrillic on both sides — the case an
			// a-to-z-only comparison silently turned into "no words at all"
			expect(withIndustry('Логистика', 'Логистика').fieldsCorrect).toBe(1)
			expect(withIndustry('Логистика', 'Строительство').fieldsCorrect).toBe(0)
		})

		it('should still miss a genuinely different trade', () => {
			// GIVEN a bank a run labelled "banking" against a golden of "insurance"
			// WHEN no stem is shared — THEN it counts as wrong, the signal the eval
			// exists to give
			expect(withIndustry('insurance', 'banking').fieldsCorrect).toBe(0)
		})

		it('should score a name with nothing to fold as a miss, not a match', () => {
			// GIVEN a run that answered with punctuation only
			// WHEN there is no word in it — THEN it matches nothing, rather than
			// matching every other empty folding
			expect(withIndustry('Fusteria', '...').fieldsCorrect).toBe(0)
		})
	})

	describe('when scoring the fields it filled', () => {
		it('should count a correct filled field and ignore an unfilled one', () => {
			// GIVEN industry correct, country left blank
			const result = scoreRun(
				acme,
				outcome({ fields: { industry: 'Transport', country: null } }),
			)

			// WHEN scored — THEN only the filled field is judged, and it matched
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(1)
		})

		it('should count a filled-but-wrong field as scored, not correct', () => {
			// GIVEN a wrong industry
			const result = scoreRun(acme, outcome({ fields: { industry: 'retail' } }))

			// WHEN scored — THEN it counts against precision
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(0)
		})

		it('should not score a field the golden set has no truth for', () => {
			// GIVEN industry (in the expectation) plus location (NOT in acme's golden fields)
			const result = scoreRun(
				acme,
				outcome({
					fields: { industry: 'transport', location: 'Barcelona' },
				}),
			)

			// WHEN scored — THEN only industry is judged; location has no golden truth
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(1)
		})

		it('should match a location that differs only in formatting', () => {
			// GIVEN an extracted location that contains the golden city
			const result = scoreRun(
				{ ...acme, fields: { location: 'Barcelona' } },
				outcome({
					fields: {
						location: 'Barcelona, Catalonia, Spain',
					},
				}),
			)

			// WHEN scored — THEN containment matching accepts it
			expect(result.fieldsScored).toBe(1)
			expect(result.fieldsCorrect).toBe(1)
		})

		it('should count every known field as expected, even the unfilled ones', () => {
			// GIVEN a run that fills 2 of acme's 3 golden fields, both correct
			const result = scoreRun(
				acme,
				outcome({ fields: { industry: 'transport', country: 'ES' } }),
			)

			// WHEN scored — THEN all 3 known fields count toward recall; 2 were filled
			expect(result.fieldsExpected).toBe(3)
			expect(result.fieldsScored).toBe(2)
			expect(result.fieldsCorrect).toBe(2)
		})
	})

	describe('when the golden set lists expected contacts', () => {
		const withContacts: GoldenExpectation = {
			...acme,
			contacts: [{ name: 'Andrew Smith' }, { name: 'María García' }],
		}

		it('should count a known contact returned with a title as found', () => {
			// GIVEN a run that returned one of the two known people, with a title
			const result = scoreRun(
				withContacts,
				outcome({
					contacts: [{ name: 'Andrew Smith', role: 'CEO' }],
				}),
			)

			// WHEN scored — THEN both are expected, one was recovered with a title
			expect(result.contactsExpected).toBe(2)
			expect(result.contactsFound).toBe(1)
		})

		it('should not count a known contact returned without a title', () => {
			// GIVEN the person came back as a bare name, no role
			const result = scoreRun(
				withContacts,
				outcome({
					contacts: [{ name: 'Andrew Smith', role: null }],
				}),
			)

			// WHEN scored — THEN a titleless contact is the gap this metric watches, so it isn't "found"
			expect(result.contactsExpected).toBe(2)
			expect(result.contactsFound).toBe(0)
		})

		it('should match a name that carries an extra middle token or an accent', () => {
			// GIVEN the run reports a fuller name and an un-accented spelling
			const result = scoreRun(
				withContacts,
				outcome({
					contacts: [
						{ name: 'Andrew J. Smith', role: 'CEO' },
						{ name: 'Maria Garcia', role: 'CFO' },
					],
				}),
			)

			// WHEN scored — THEN token-subset + accent-folding match both people
			expect(result.contactsFound).toBe(2)
		})

		it('should match a name carrying an honorific prefix', () => {
			// GIVEN the run returns the same person with a "Sir" title prefix
			const withDyson: GoldenExpectation = {
				...acme,
				contacts: [{ name: 'James Dyson' }],
			}
			const result = scoreRun(
				withDyson,
				outcome({
					contacts: [{ name: 'Sir James Dyson', role: 'Founder' }],
				}),
			)

			// THEN the honorific is dropped before matching, so the person is found
			expect(result.contactsFound).toBe(1)
		})

		it('should match an everyday nickname against the published formal name', () => {
			// GIVEN the golden lists a nickname and the run returns the formal name
			const withPete: GoldenExpectation = {
				...acme,
				contacts: [{ name: 'Pete Roever' }],
			}
			const result = scoreRun(
				withPete,
				outcome({
					contacts: [{ name: 'Peter Roever', role: 'VP Sales' }],
				}),
			)

			// THEN "Pete" folds to "Peter" so the same person matches
			expect(result.contactsFound).toBe(1)
		})

		it('should not match a different person who shares one name token', () => {
			// GIVEN a same-surname stranger the run returned with a title
			const result = scoreRun(
				withContacts,
				outcome({
					contacts: [{ name: 'Robert Smith', role: 'Intern' }],
				}),
			)

			// WHEN scored — THEN a partial token overlap is not a match; recall stays honest
			expect(result.contactsFound).toBe(0)
		})

		it('should not match two people who differ only by a middle initial', () => {
			// GIVEN a golden person whose name carries a middle initial
			const withInitial: GoldenExpectation = {
				...acme,
				contacts: [{ name: 'Jon A Park' }],
			}

			// WHEN the run returns a different person with the same first+last but
			// another initial
			const result = scoreRun(
				withInitial,
				outcome({ contacts: [{ name: 'Jon B Park', role: 'CEO' }] }),
			)

			// THEN the differing initial keeps them distinct — the initial is a real
			// token, not dropped, so recall doesn't over-count a look-alike name
			expect(result.contactsFound).toBe(0)
		})

		it('should expect zero contacts when the golden set lists none', () => {
			// GIVEN acme, whose golden row has no contacts, and a run that found one
			const result = scoreRun(
				acme,
				outcome({ contacts: [{ name: 'Someone', role: 'CEO' }] }),
			)

			// WHEN scored — THEN there is nothing to recall, so the metric is inert
			expect(result.contactsExpected).toBe(0)
			expect(result.contactsFound).toBe(0)
		})
	})
})

describe('summarizeScores', () => {
	const score = (over: Partial<RunScore>): RunScore => ({
		id: 'r',
		grounded: true,
		wrongCompany: false,
		wrongCompanyAutoApplicable: false,
		lowConfidence: false,
		empty: false,
		fieldsExpected: 0,
		fieldsScored: 0,
		fieldsCorrect: 0,
		contactsExpected: 0,
		contactsFound: 0,
		...over,
	})

	describe('when there are no scores', () => {
		it('should report zeros and an undefined precision and recall', () => {
			// GIVEN an empty run set
			const summary = summarizeScores([])

			// WHEN summarized — THEN nothing is asserted as a rate; every figure that
			// would need a run to divide by stays null rather than reading as zero
			expect(summary).toEqual({
				runs: 0,
				groundingAccuracy: 0,
				wrongCompanyRate: 0,
				wrongCompanyAutoApplicableRate: 0,
				lowConfidenceRate: 0,
				emptyRate: 0,
				fieldPrecision: null,
				fieldRecall: null,
				contactRecall: null,
				fieldsFilledPerRun: null,
				profileFieldsTotal: null,
				contactsNamedPerRun: null,
				contactsTitledPerRun: null,
				costPerRun: null,
				costPerGroundedRun: null,
				paidCostPerRun: null,
				tokensPerRun: null,
				creditsPerRun: null,
				callsByModel: {},
				cascadedRunRate: null,
			})
		})
	})

	describe('when the runs report how full their profiles came back', () => {
		it('should average the fields filled and the people named', () => {
			// GIVEN two runs, one that came back full and one nearly empty
			const summary = summarizeScores([
				score({
					profile: {
						fieldsTotal: 6,
						fieldsFilled: 6,
						contactsNamed: 4,
						contactsTitled: 3,
					},
				}),
				score({
					profile: {
						fieldsTotal: 6,
						fieldsFilled: 2,
						contactsNamed: 0,
						contactsTitled: 0,
					},
				}),
			])

			// WHEN summarized — THEN the averages say how full a profile came back,
			// which the golden-answer scores cannot: a run answering four scalars
			// and nothing else looks perfect to them
			expect(summary.fieldsFilledPerRun).toBe(4)
			expect(summary.profileFieldsTotal).toBe(6)
			expect(summary.contactsNamedPerRun).toBe(2)
			expect(summary.contactsTitledPerRun).toBe(1.5)
		})
	})

	describe('when no run reported how full its profile came back', () => {
		it('should report no fullness figures at all', () => {
			// GIVEN scores from a pass that never read the fullness back
			const summary = summarizeScores([score({}), score({})])

			// WHEN summarized — THEN the figures stay absent rather than reading as
			// zero, which would look like a pass that found nothing
			expect(summary.fieldsFilledPerRun).toBeNull()
			expect(summary.contactsNamedPerRun).toBeNull()
		})
	})

	describe('when a run that shipped the wrong company was flagged for review', () => {
		it('should keep it out of the unwatched count but not the overall one', () => {
			// GIVEN two look-alike runs, one of which finished needing review
			const lookAlike = {
				grounded: false,
				wrongCompany: true,
				empty: false,
			}
			const summary = summarizeScores([
				score({ ...lookAlike, wrongCompanyAutoApplicable: true }),
				score({
					...lookAlike,
					lowConfidence: true,
					wrongCompanyAutoApplicable: false,
				}),
			])

			// WHEN summarized — THEN both count as wrong, but only the one nobody
			// would have read counts as having been able to reach a record on its own
			expect(summary.wrongCompanyRate).toBe(1)
			expect(summary.wrongCompanyAutoApplicableRate).toBe(0.5)
			expect(summary.lowConfidenceRate).toBe(0.5)
		})
	})

	describe('when a tier answered on more than one model', () => {
		const usage = (callsByModel: Record<string, number>) => ({
			costCents: 5,
			paidCostCents: 0,
			tokensIn: 100,
			tokensOut: 20,
			creditsUsed: 2,
			callsByModel,
		})

		it('should count the calls each model took across the pass', () => {
			// GIVEN two runs, one of which fell back partway through
			const summary = summarizeScores([
				score({ usage: usage({ 'agent@primary': 4 }) }),
				score({ usage: usage({ 'agent@primary': 3, 'agent@fallback': 2 }) }),
			])

			// WHEN summarized — THEN the totals name both models, so a reader can
			// see how much of the pass the fallback carried
			expect(summary.callsByModel).toEqual({
				'agent@primary': 7,
				'agent@fallback': 2,
			})
		})

		it('should report the share of runs that fell back', () => {
			// GIVEN three runs, one of them cascaded
			const summary = summarizeScores([
				score({ usage: usage({ 'agent@primary': 4 }) }),
				score({ usage: usage({ 'agent@primary': 3, 'agent@fallback': 2 }) }),
				score({ usage: usage({ 'agent@primary': 5 }) }),
			])

			// WHEN summarized — THEN a third of the pass is flagged as having been
			// answered by something other than the models it set out to measure
			expect(summary.cascadedRunRate).toBeCloseTo(1 / 3)
		})

		it('should report no fallback when every tier stayed on one model', () => {
			// GIVEN two runs, each answered entirely by its first choice — note
			// two DIFFERENT tiers in one run must not read as a fallback
			const summary = summarizeScores([
				score({ usage: usage({ 'agent@primary': 4, 'extract@other': 1 }) }),
				score({ usage: usage({ 'agent@primary': 2 }) }),
			])

			// WHEN summarized — THEN the pass is clean and the scores speak for
			// the models they were taken on
			expect(summary.cascadedRunRate).toBe(0)
		})
	})

	describe('when runs mix grounded, wrong-company, and empty outcomes', () => {
		it('should average each rate over all runs', () => {
			// GIVEN 4 runs: 2 grounded, 1 wrong-company, 1 empty
			const summary = summarizeScores([
				score({ grounded: true }),
				score({ grounded: true }),
				score({ grounded: false, wrongCompany: true }),
				score({ grounded: false, empty: true }),
			])

			// WHEN summarized — THEN each rate is the fraction over 4
			expect(summary.runs).toBe(4)
			expect(summary.groundingAccuracy).toBe(0.5)
			expect(summary.wrongCompanyRate).toBe(0.25)
			expect(summary.emptyRate).toBe(0.25)
		})
	})

	describe('when the runs recorded what they cost', () => {
		it('should average over the runs, and per usable run over the grounded ones', () => {
			// GIVEN four runs costing 100¢ in total, of which two grounded
			const spend = (costCents: number, creditsUsed: number) => ({
				costCents,
				paidCostCents: 0,
				tokensIn: 1000,
				tokensOut: 500,
				creditsUsed,
			})
			const summary = summarizeScores([
				score({ grounded: true, usage: spend(40, 7) }),
				score({ grounded: true, usage: spend(30, 7) }),
				score({ grounded: false, usage: spend(20, 3) }),
				score({ grounded: false, empty: true, usage: spend(10, 3) }),
			])

			// WHEN summarized
			// THEN the per-run figure spreads over all four, while the per-usable-run
			// one spreads over the two that grounded — so runs that found nothing
			// count as waste rather than disappearing
			expect(summary.costPerRun).toBe(25)
			expect(summary.costPerGroundedRun).toBe(50)
			expect(summary.tokensPerRun).toBe(1500)
			expect(summary.creditsPerRun).toBe(5)
		})
	})

	describe('when no run recorded what it cost', () => {
		it('should report no cost rather than zero', () => {
			// GIVEN runs scored without any cost read back
			const summary = summarizeScores([score({}), score({})])

			// WHEN summarized
			// THEN the figures are absent — a zero would read as a free pass
			expect(summary.costPerRun).toBeNull()
			expect(summary.creditsPerRun).toBeNull()
		})
	})

	describe('when scored fields span several runs', () => {
		it('should micro-average precision over filled fields and recall over known fields', () => {
			// GIVEN 3 correct of 4 FILLED fields, but 6 fields were KNOWN across two runs
			const summary = summarizeScores([
				score({ fieldsExpected: 3, fieldsScored: 2, fieldsCorrect: 2 }),
				score({ fieldsExpected: 3, fieldsScored: 2, fieldsCorrect: 1 }),
			])

			// WHEN summarized — THEN precision is correct÷filled, recall is correct÷known
			expect(summary.fieldPrecision).toBe(0.75)
			expect(summary.fieldRecall).toBe(0.5)
		})
	})

	describe('when runs knew fields but filled none of them', () => {
		it('should report precision null but recall zero', () => {
			// GIVEN a run whose golden fields were all left blank
			const summary = summarizeScores([
				score({ fieldsExpected: 3, fieldsScored: 0, fieldsCorrect: 0 }),
			])

			// WHEN summarized — THEN nothing was filled to judge (precision null), but
			// everything known was missed (recall 0) — the two are not the same signal
			expect(summary.fieldPrecision).toBeNull()
			expect(summary.fieldRecall).toBe(0)
		})
	})

	describe('when runs listed expected contacts', () => {
		it('should micro-average contact recall over all known contacts', () => {
			// GIVEN 3 found of 5 known contacts across two runs
			const summary = summarizeScores([
				score({ contactsExpected: 2, contactsFound: 2 }),
				score({ contactsExpected: 3, contactsFound: 1 }),
			])

			// WHEN summarized — THEN recall is found÷known across the batch, not a per-run mean
			expect(summary.contactRecall).toBe(0.6)
		})
	})

	describe('when no run listed expected contacts', () => {
		it('should report contact recall null, not zero', () => {
			// GIVEN runs whose golden rows named no people to recover
			const summary = summarizeScores([score({}), score({})])

			// WHEN summarized — THEN there was nothing to recall, so the rate is absent
			expect(summary.contactRecall).toBeNull()
		})
	})
})

describe('scoreRun — bucket and country', () => {
	describe('when the golden row is tagged with a bucket', () => {
		it('should carry the bucket and expected country onto the score', () => {
			// GIVEN a golden row tagged niche (its country is ES)
			const result = scoreRun({ ...acme, bucket: 'niche' }, outcome({}))
			// WHEN scored — THEN both are carried through for grouping
			expect(result.bucket).toBe('niche')
			expect(result.country).toBe('ES')
		})
	})

	describe('when the golden row has no bucket', () => {
		it('should leave the bucket undefined', () => {
			// GIVEN an untagged golden row
			const result = scoreRun(acme, outcome({}))
			// WHEN scored — THEN there is no bucket, but the country still rides along
			expect(result.bucket).toBeUndefined()
			expect(result.country).toBe('ES')
		})
	})
})

describe('groupSummaries', () => {
	describe('when scores span several buckets', () => {
		it('should summarize each bucket independently', () => {
			// GIVEN a grounded big-bucket run and an empty niche-bucket run
			const scores: RunScore[] = [
				scoreRun(
					{ ...acme, bucket: 'big' },
					outcome({
						reachedDomains: ['acme.es'],
						fields: { industry: 'transport' },
					}),
				),
				scoreRun(
					{ ...acme, id: 'other', bucket: 'niche' },
					outcome({
						status: 'no_reliable_data',
						reachedDomains: [],
						fields: {},
					}),
				),
			]
			// WHEN grouped by bucket
			const byBucket = groupSummaries(scores, s => s.bucket ?? 'untagged')
			// THEN each bucket is summarized on its own
			expect(Object.keys(byBucket).sort()).toEqual(['big', 'niche'])
			expect(byBucket['big']?.runs).toBe(1)
			expect(byBucket['big']?.emptyRate).toBe(0)
			expect(byBucket['niche']?.emptyRate).toBe(1)
		})
	})
})

describe('scoreRun for the company shapes this measures', () => {
	// A company with no website of its own: the only proof the run reached it is a
	// register entry, given as an alt domain.
	const noWebsite: GoldenExpectation = {
		id: 'taller-puig',
		query: 'Taller Puig, Girona',
		officialDomain: null,
		altDomains: ['librebor.es'],
		fields: { country: 'ES' },
	}

	describe('when the company has no website at all', () => {
		it('should ground on the register entry that stands in for one', () => {
			// GIVEN a run that reached only the register page
			const result = scoreRun(
				noWebsite,
				outcome({
					reachedDomains: ['https://librebor.es/busqueda/taller-puig'],
					fields: { country: 'ES' },
				}),
			)

			// THEN it counts as having reached the target
			expect(result.grounded).toBe(true)
			expect(result.wrongCompany).toBe(false)
		})

		it('should not ground on an unrelated site', () => {
			// GIVEN a run that read somebody else's page
			const result = scoreRun(
				noWebsite,
				outcome({ reachedDomains: ['https://other-company.es/'] }),
			)

			// THEN a null official domain does not make everything ground
			expect(result.grounded).toBe(false)
		})
	})

	describe('when the only thing a run found was the published mailbox', () => {
		it('should not count as an empty run', () => {
			// GIVEN a thin-web company whose contact page prints one role address,
			// and a run that came back with that and nothing else
			const result = scoreRun(
				noWebsite,
				outcome({
					reachedDomains: ['https://librebor.es/x'],
					fields: { email: 'info@tallerpuig.es' },
				}),
			)

			// THEN the run is not filed with the ones that found nothing — a way of
			// reaching the company is the most actionable thing there is to find
			expect(result.empty).toBe(false)
		})
	})

	describe('when a telephone number is written differently on each page', () => {
		it('should match on the digits, ignoring spacing and country code', () => {
			const expectedPhone: GoldenExpectation = {
				id: 'phone',
				query: 'Acme',
				officialDomain: 'acme.es',
				fields: { phone: '+34 972 123 456' },
			}

			// GIVEN the same line printed without its country code or spacing
			const same = scoreRun(
				expectedPhone,
				outcome({ fields: { phone: '972123456' } }),
			)
			// THEN it is one number, scored correct
			expect(same.fieldsCorrect).toBe(1)

			// AND a genuinely different line is not
			const different = scoreRun(
				expectedPhone,
				outcome({ fields: { phone: '+34 972 123 457' } }),
			)
			expect(different.fieldsCorrect).toBe(0)
			expect(different.fieldsScored).toBe(1)
		})
	})

	describe('when a registration number carries punctuation or a prefix', () => {
		it('should match on its letters and digits alone', () => {
			const expectedTaxId: GoldenExpectation = {
				id: 'tax',
				query: 'Acme',
				officialDomain: 'acme.es',
				fields: { tax_id: 'B-12345678' },
			}

			// GIVEN the same number printed without the hyphen and in lower case
			expect(
				scoreRun(expectedTaxId, outcome({ fields: { tax_id: 'b12345678' } }))
					.fieldsCorrect,
			).toBe(1)

			// AND a different company's number does not match
			expect(
				scoreRun(expectedTaxId, outcome({ fields: { tax_id: 'B12345679' } }))
					.fieldsCorrect,
			).toBe(0)
		})
	})

	describe('when a row states no expected value for the new fields', () => {
		it('should not count them against precision or recall', () => {
			// GIVEN the original row, which states industry, country and size only
			const result = scoreRun(
				acme,
				outcome({
					fields: {
						industry: 'transport',
						country: 'ES',
						size_range: '11-50',
						// Values the golden row says nothing about
						email: 'info@acme.es',
						phone: '+34 900 000 000',
					},
				}),
			)

			// THEN only the three the row has an answer for are counted, so adding
			// fields to the scored list cannot move a historic row's numbers
			expect(result.fieldsExpected).toBe(3)
			expect(result.fieldsScored).toBe(3)
			expect(result.fieldsCorrect).toBe(3)
		})
	})
})
