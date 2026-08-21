/**
 * Pure scoring for the research eval harness. Given a company's known-correct
 * answer (the golden expectation) and a normalized view of what one research run
 * produced, it computes the numbers the harness reports:
 *
 *   grounding accuracy   did the run actually reach the *target* company's own site?
 *   field precision      of the fields it filled that we have a true answer for,
 *                        how many are right?
 *   contact recall       of the people the company is known to publish, how many
 *                        came back *with a title* — contacts sit outside the scorable
 *                        field set, so a run can pass every field yet lose the
 *                        decision-makers' titles, the exact gap this metric watches.
 *   wrong-company rate   did it confidently return some OTHER company's data (the
 *                        look-alike failure this harness exists to catch)? A run that
 *                        returned the known-correct company's data but never reached
 *                        its official site is a grounding miss, not a look-alike, and
 *                        is judged against the golden rather than counted here.
 *   empty rate           did it return no usable data at all?
 *
 * A search for a whole market answers with a list rather than a profile, so none of
 * the above is the question it should be graded on. Counting how many companies came
 * back would have called a 62-row list healthy when 23 of the rows were trade bodies,
 * 10 were the same company twice, and four of the five trades asked for were missing.
 * A market is graded on what was actually wrong with that list instead:
 *
 *   organisation kind    how many rows are the kind of organisation that was asked for
 *   request coverage     how many of the parts the request named came back with a row
 *   duplicate rate       whether the fold that joins two rows of one company still
 *                        holds, beside a looser reading of the same list that shows
 *                        the repeats that fold's keys cannot see at all
 *   location fill        how many rows say what town or province the company is in
 *
 * The row count is still reported, as the scale those four read against rather than
 * as the grade — it is also what checking that every row is a real company would
 * cost, so it needs a reading of its own before that check exists.
 *
 * Grounding is judged by which pages the run *fetched*, not which its findings cite:
 * once per-field citations point at whichever page stated each fact, a run that
 * correctly reached the target's own site still cites third-party pages per field,
 * so citation hosts no longer track "reached the right company" — the fetch log does.
 * A run is also grounded without fetching the target's site at all when an official
 * company-register lookup resolved the target by legal name — an independent proof
 * the right entity was reached.
 *
 * The two halves this rolls up live beside it: eval-scoring-company.ts grades one
 * company's profile, eval-scoring-market.ts grades a market's list, and the shapes both
 * are written against are in eval-scoring-types.ts.
 */

import type { OrganisationKind } from './eval-organisation-kind'
import {
	contactNameMatches,
	fieldMatches,
	isFilled,
	normalizeDomain,
	specificLocationAgrees,
} from './eval-scoring-company'
import {
	isKnownNonCompany,
	partsAnsweredBy,
	repeatedRows,
} from './eval-scoring-market'
import {
	type EvalSummary,
	endedWithAnAnswer,
	type FieldOutcome,
	type GoldenExpectation,
	isSucceeded,
	type MarketScore,
	type RunOutcome,
	type RunScore,
	SCORABLE_FIELDS,
} from './eval-scoring-types'
import { tradeWordsOf } from './trade-words'

export { contactNameMatches } from './eval-scoring-company'
export {
	type EvalSummary,
	type FieldOutcome,
	GOLDEN_BUCKETS,
	type GoldenBucket,
	type GoldenExpectation,
	isSucceeded,
	type MarketExpectation,
	type MarketPart,
	type MarketScore,
	normalizeText,
	type ProfileFullness,
	type RunOutcome,
	type RunScore,
	type RunUsage,
	SCORABLE_FIELDS,
	type ScorableField,
	type TerminalStatus,
} from './eval-scoring-types'
export { foldDiacritics, termTokens } from './term-match'

/** Score one run against its golden expectation. */
export const scoreRun = (
	expected: GoldenExpectation,
	outcome: RunOutcome,
	// What a model made of each returned row, in the order they came back. Decided
	// outside because asking a model is not something a scoring function can do, and
	// left out entirely by a pass that did not ask.
	organisationKinds?: ReadonlyArray<OrganisationKind>,
): RunScore => {
	const anchors = [
		...(expected.officialDomain === null ? [] : [expected.officialDomain]),
		...(expected.altDomains ?? []),
	].map(normalizeDomain)
	// Reached the target either by fetching its own site (or a subdomain / alt
	// domain), or by resolving it in the official company register — a registry
	// confirmation grounds a company whose own site was never scraped.
	const grounded =
		outcome.registryConfirmed === true ||
		outcome.reachedDomains.some(reached => {
			const host = normalizeDomain(reached)
			// The official host itself, or a subdomain of it (careers.acme.com,
			// us.acme.com) — both are the company's own pages, so both prove the run
			// reached the target. A look-alike host never ends with ".<official>".
			return anchors.some(
				anchor => host === anchor || host.endsWith(`.${anchor}`),
			)
		})

	let fieldsExpected = 0
	let fieldsScored = 0
	let fieldsCorrect = 0
	// Kept alongside the counts, off the same comparisons, so a report can say which
	// field missed and what came back — which the counts alone cannot, and which
	// otherwise costs a whole second pass to find out.
	const fieldOutcomes: FieldOutcome[] = []
	for (const field of SCORABLE_FIELDS) {
		const expectedValue = expected.fields[field]
		if (expectedValue === undefined) continue
		// Recall's denominator: every field we have a true answer for.
		fieldsExpected++
		const actual = outcome.fields[field]
		// Precision's denominator: only the ones the run actually filled.
		if (!isFilled(actual)) {
			fieldOutcomes.push({
				field,
				expected: expectedValue,
				got: null,
				scored: false,
				correct: false,
			})
			continue
		}
		fieldsScored++
		const correct = fieldMatches(field, expectedValue, actual)
		if (correct) fieldsCorrect++
		fieldOutcomes.push({
			field,
			expected: expectedValue,
			got: actual,
			scored: true,
			correct,
		})
	}

	const anyFilled = SCORABLE_FIELDS.some(field =>
		isFilled(outcome.fields[field]),
	)
	// A run has found something when it filled a profile field OR came back with
	// companies: a scan answers with a list and never fills a profile, so asking
	// only about fields files every scan alongside the runs that found nothing.
	const empty =
		!isSucceeded(outcome.status) ||
		(!anyFilled && outcome.companies.length === 0)

	// Contact recall: of the people we know the company publishes, how many the run
	// returned WITH a title — a named person with no title doesn't count, since a
	// titleless contact is the gap the focused pass exists to close. A name match
	// WITHOUT a title still proves the run reached the right company, so track that
	// separately to judge wrong-company below.
	const expectedContacts = expected.contacts ?? []
	let contactsFound = 0
	let anyContactMatched = false
	for (const person of expectedContacts) {
		const matches = outcome.contacts.filter(found =>
			contactNameMatches(person.name, found.name),
		)
		if (matches.length === 0) continue
		anyContactMatched = true
		if (matches.some(found => isFilled(found.role))) contactsFound++
	}

	// "Wrong company" is the look-alike bug: a confident run that shipped some OTHER
	// company's data. A run that returned the known-correct company's data yet never
	// reached its official site is a grounding-proxy miss, not a look-alike, so it is
	// excused here. The agreement bar is deliberately high — a matched known person, or
	// a location specific enough to identify the company — so a real look-alike (a
	// different person in a different place) is still caught; a coarse industry code or
	// a global capital is too generic to qualify.
	const agreesWithGolden =
		anyContactMatched || specificLocationAgrees(expected, outcome)
	// Only a run that answered about one company can have answered about the wrong
	// one. Both halves of the test below — reaching the golden domain, and matching
	// its contacts or its city — are written against a single expected company, so
	// a scan's list of others has nothing here to be judged against and would read
	// as wrong simply for being a list.
	const aboutOneCompany = outcome.companies.length === 0
	const wrongCompany =
		aboutOneCompany &&
		isSucceeded(outcome.status) &&
		!empty &&
		!grounded &&
		!agreesWithGolden

	// The same look-alike, narrowed to the runs that finished clean. A run marked
	// as needing review is caught by the person reading it, so it cannot be in the
	// count of what got far enough to be written unwatched.
	const lowConfidence = outcome.status === 'succeeded_low_confidence'
	const wrongCompanyAutoApplicable = wrongCompany && !lowConfidence

	// What the list got right, for a row that asked for a market.
	//
	// Only a run that reached an answer is measured. A run that died — a provider
	// outage, or the whole-run time limit cutting a long search short — returns no
	// rows, and counting it would put the parts it was asked for into the denominator
	// with nothing in the numerator: one crashed run out of two halves the coverage
	// figure and reads as a regression the research never had.
	//
	// A search that looked and found nothing is the opposite case and has to count.
	// It ends as no reliable data rather than a success, so asking only whether the
	// run succeeded would throw away the very reading that catches a change which
	// empties a market — and with one run per market, throw away the whole market
	// with it.
	const expectedMarket = expected.market
	// What each row is, and what settled it. Without a judge this is the reading the
	// figure has always had: the golden file's list decides, and everything else is
	// taken to be a company.
	const kinds: ReadonlyArray<OrganisationKind> =
		organisationKinds ??
		outcome.companies.map(row => {
			const listed =
				expectedMarket !== undefined &&
				isKnownNonCompany(row.name, expectedMarket.notCompanies)
			return {
				isCompany: !listed,
				method: listed ? ('golden-listed' as const) : ('unjudged' as const),
			}
		})
	const rightKindRows = outcome.companies.filter(
		(_, index) => kinds[index]?.isCompany ?? true,
	)
	// Read with the trades the golden file wrote down for this market, which is the
	// nearest thing the eval holds to the words the run itself went looking for. A
	// reading with no trades at all would establish more sites than the run's fold
	// did and then report as duplicates the rows the fold was right to leave apart.
	//
	// The golden wordings rather than the ones the run split its own request into,
	// though those are closer to what the fold read: the run's are written afresh
	// every pass, so a duplicate count read off them would move between two passes
	// of one market for reasons that have nothing to do with the change under
	// measurement. A company row names no market and so no trades, which is what
	// its run read too.
	const repeats = repeatedRows(
		outcome.companies,
		tradeWordsOf(expectedMarket?.parts.flatMap(part => part.terms) ?? []),
	)
	const market: MarketScore | undefined =
		expectedMarket === undefined || !endedWithAnAnswer(outcome.status)
			? undefined
			: {
					name: expectedMarket.name,
					rowsGoldenListed: kinds.filter(k => k.method === 'golden-listed')
						.length,
					rowsJudged: kinds.filter(k => k.method === 'judged').length,
					rowsUnjudged: kinds.filter(k => k.method === 'unjudged').length,
					rowsReturned: outcome.companies.length,
					rowsConfirmed: outcome.companies.filter(row => row.confirmed).length,
					rowsRightKind: rightKindRows.length,
					rowsLocated: outcome.companies.filter(row => isFilled(row.location))
						.length,
					rowsDuplicated: repeats.duplicated,
					rowsPossiblyDuplicated: repeats.possiblyDuplicated,
					partsExpected: expectedMarket.parts.length,
					// Coverage counts the parts the request named rather than the rows, so
					// a market that came back with nothing still reports it — none of them
					// answered — instead of dropping out of the figure.
					partsAnswered: partsAnsweredBy(rightKindRows, expectedMarket.parts),
					reportedCoverage: outcome.reportedCoverage,
				}

	return {
		id: expected.id,
		grounded,
		groundable: expected.market === undefined,
		wrongCompany,
		wrongCompanyAutoApplicable,
		lowConfidence,
		empty,
		fieldsExpected,
		fieldsScored,
		fieldsCorrect,
		fields: fieldOutcomes,
		contactsExpected: expectedContacts.length,
		contactsFound,
		...(outcome.profile !== undefined ? { profile: outcome.profile } : {}),
		...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
		...(market !== undefined ? { market } : {}),
		...(expected.bucket !== undefined ? { bucket: expected.bucket } : {}),
		...(expected.fields.country !== undefined
			? { country: expected.fields.country }
			: {}),
	}
}

/** Roll per-run scores up into the rates the harness reports. */
export const summarizeScores = (
	scores: ReadonlyArray<RunScore>,
): EvalSummary => {
	const runs = scores.length
	if (runs === 0) {
		return {
			runs: 0,
			groundingAccuracy: null,
			wrongCompanyRate: null,
			wrongCompanyAutoApplicableRate: null,
			lowConfidenceRate: 0,
			emptyRate: 0,
			fieldPrecision: null,
			fieldRecall: null,
			contactRecall: null,
			organisationKindPrecision: null,
			confirmationRate: null,
			rowsJudgedShare: null,
			rowsGoldenListedShare: null,
			requestCoverage: null,
			neverSearchedShare: null,
			scansReportingCoverage: null,
			partsThoughtAnswered: null,
			duplicateRate: null,
			possibleDuplicateRate: null,
			locationFill: null,
			rowsPerScan: null,
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
		}
	}

	let grounded = 0
	let groundable = 0
	let wrong = 0
	let wrongAutoApplicable = 0
	let lowConfidence = 0
	let empty = 0
	let runsWithProfile = 0
	let profileFieldsTotal = 0
	let totalFieldsFilled = 0
	let totalContactsNamed = 0
	let totalContactsTitled = 0
	const callsByModel: Record<string, number> = {}
	let cascadedRuns = 0
	let totalExpected = 0
	let totalScored = 0
	let totalCorrect = 0
	let totalContactsExpected = 0
	let totalContactsFound = 0
	// Only runs that reported a cost count toward the averages, so a pass that
	// never read them back shows no figure rather than a misleadingly low one.
	let runsWithUsage = 0
	let totalCostCents = 0
	let groundableCostCents = 0
	let groundedRunsWithUsage = 0
	let totalPaidCostCents = 0
	let totalTokensIn = 0
	let totalTokensOut = 0
	let totalCredits = 0
	// The market figures, totalled as counts and divided once at the end, so a
	// sixty-row market weighs sixty rows against a six-row one's six.
	let scansScored = 0
	let totalRowsReturned = 0
	let totalRowsRightKind = 0
	let totalRowsConfirmed = 0
	let totalRowsJudged = 0
	let totalRowsGoldenListed = 0
	let totalRowsLocated = 0
	let totalRowsDuplicated = 0
	let totalRowsPossiblyDuplicated = 0
	let totalPartsExpected = 0
	let totalPartsAnswered = 0
	// Counted only over the scans that stored a reckoning of their own, so the
	// share below divides one run's words by the same run's words.
	let scansReportingCoverage = 0
	let totalReportedMissing = 0
	let totalReportedNeverSearched = 0
	let totalReportedThoughtAnswered = 0
	for (const score of scores) {
		// Only a run that was asked to reach a particular company can be counted for
		// having reached it.
		if (score.groundable) {
			groundable++
			if (score.grounded) grounded++
		}
		// The cost figure below divides by this rather than by every grounded run,
		// so that a run whose spend was never read back cannot sit in the divisor
		// with nothing above the line and drag the figure under the plain per-run cost.
		if (score.groundable && score.grounded && score.usage !== undefined)
			groundedRunsWithUsage++
		// The look-alike counts ask the same question grounding does — was this the
		// company we sent it after — so a market request is outside them too. It can
		// never be a look-alike, and leaving it in the denominator quietly waters the
		// rate down with runs that had no way to fail it.
		if (score.groundable) {
			if (score.wrongCompany) wrong++
			if (score.wrongCompanyAutoApplicable) wrongAutoApplicable++
		}
		if (score.lowConfidence) lowConfidence++
		if (score.empty) empty++
		if (score.profile !== undefined) {
			runsWithProfile++
			// Every run is measured against the same profile shape, so this is the
			// same number each time round — kept as scale for the filled count, not
			// something to add up.
			profileFieldsTotal = score.profile.fieldsTotal
			totalFieldsFilled += score.profile.fieldsFilled
			totalContactsNamed += score.profile.contactsNamed
			totalContactsTitled += score.profile.contactsTitled
		}
		if (score.market !== undefined) {
			scansScored++
			totalRowsReturned += score.market.rowsReturned
			totalRowsRightKind += score.market.rowsRightKind
			totalRowsConfirmed += score.market.rowsConfirmed
			totalRowsJudged += score.market.rowsJudged
			totalRowsGoldenListed += score.market.rowsGoldenListed
			totalRowsLocated += score.market.rowsLocated
			totalRowsDuplicated += score.market.rowsDuplicated
			totalRowsPossiblyDuplicated += score.market.rowsPossiblyDuplicated
			totalPartsExpected += score.market.partsExpected
			totalPartsAnswered += score.market.partsAnswered
			const reckoning = score.market.reportedCoverage
			if (reckoning !== null) {
				scansReportingCoverage++
				totalReportedMissing += reckoning.missing
				totalReportedNeverSearched += reckoning.neverSearched
				totalReportedThoughtAnswered += reckoning.thoughtAnswered
			}
		}
		totalExpected += score.fieldsExpected
		totalScored += score.fieldsScored
		totalCorrect += score.fieldsCorrect
		totalContactsExpected += score.contactsExpected
		totalContactsFound += score.contactsFound
		if (score.usage !== undefined) {
			runsWithUsage++
			totalCostCents += score.usage.costCents
			// What a usable run cost divides by the runs that grounded, so only what
			// those runs spent belongs on top of it. A market request grounds nothing
			// and can cost more than a profile run, so counting its spend here would
			// bill it to the handful of company runs and read as a cost blow-up.
			if (score.groundable) groundableCostCents += score.usage.costCents
			totalPaidCostCents += score.usage.paidCostCents
			totalTokensIn += score.usage.tokensIn
			totalTokensOut += score.usage.tokensOut
			totalCredits += score.usage.creditsUsed
			for (const [key, calls] of Object.entries(
				score.usage.callsByModel ?? {},
			)) {
				callsByModel[key] = (callsByModel[key] ?? 0) + calls
			}
			// A tier naming two models in one run answered partly on each, which
			// is what makes that run's score a reading of something other than the
			// models the pass set out to measure.
			const tiers = Object.keys(score.usage.callsByModel ?? {}).map(
				key => key.split('@')[0] ?? key,
			)
			if (new Set(tiers).size < tiers.length) cascadedRuns += 1
		}
	}

	// A market that came back with no rows at all has nothing to judge per row, but
	// its coverage still reads — none of the parts was answered, which is the whole
	// point of the figure.
	const perRow = (total: number): number | null =>
		totalRowsReturned === 0 ? null : total / totalRowsReturned

	return {
		runs,
		groundingAccuracy: groundable === 0 ? null : grounded / groundable,
		wrongCompanyRate: groundable === 0 ? null : wrong / groundable,
		wrongCompanyAutoApplicableRate:
			groundable === 0 ? null : wrongAutoApplicable / groundable,
		lowConfidenceRate: lowConfidence / runs,
		emptyRate: empty / runs,
		fieldPrecision: totalScored === 0 ? null : totalCorrect / totalScored,
		fieldRecall: totalExpected === 0 ? null : totalCorrect / totalExpected,
		contactRecall:
			totalContactsExpected === 0
				? null
				: totalContactsFound / totalContactsExpected,
		organisationKindPrecision: perRow(totalRowsRightKind),
		confirmationRate: perRow(totalRowsConfirmed),
		rowsJudgedShare: perRow(totalRowsJudged),
		rowsGoldenListedShare: perRow(totalRowsGoldenListed),
		requestCoverage:
			totalPartsExpected === 0 ? null : totalPartsAnswered / totalPartsExpected,
		neverSearchedShare:
			totalReportedMissing === 0
				? null
				: totalReportedNeverSearched / totalReportedMissing,
		scansReportingCoverage: scansScored === 0 ? null : scansReportingCoverage,
		partsThoughtAnswered:
			scansReportingCoverage === 0 ? null : totalReportedThoughtAnswered,
		duplicateRate: perRow(totalRowsDuplicated),
		possibleDuplicateRate: perRow(totalRowsPossiblyDuplicated),
		locationFill: perRow(totalRowsLocated),
		rowsPerScan: scansScored === 0 ? null : totalRowsReturned / scansScored,
		fieldsFilledPerRun:
			runsWithProfile === 0 ? null : totalFieldsFilled / runsWithProfile,
		profileFieldsTotal: runsWithProfile === 0 ? null : profileFieldsTotal,
		contactsNamedPerRun:
			runsWithProfile === 0 ? null : totalContactsNamed / runsWithProfile,
		contactsTitledPerRun:
			runsWithProfile === 0 ? null : totalContactsTitled / runsWithProfile,
		costPerRun: runsWithUsage === 0 ? null : totalCostCents / runsWithUsage,
		costPerGroundedRun:
			groundedRunsWithUsage === 0
				? null
				: groundableCostCents / groundedRunsWithUsage,
		paidCostPerRun:
			runsWithUsage === 0 ? null : totalPaidCostCents / runsWithUsage,
		tokensPerRun:
			runsWithUsage === 0
				? null
				: (totalTokensIn + totalTokensOut) / runsWithUsage,
		creditsPerRun: runsWithUsage === 0 ? null : totalCredits / runsWithUsage,
		callsByModel,
		cascadedRunRate: runsWithUsage === 0 ? null : cascadedRuns / runsWithUsage,
	}
}

/**
 * Group scores by a key (a bucket, a country) and summarize each group, so a
 * regression confined to one segment is visible instead of averaged into the
 * whole-set numbers. Keys are returned in first-seen order.
 */
export const groupSummaries = (
	scores: ReadonlyArray<RunScore>,
	keyOf: (score: RunScore) => string,
): Record<string, EvalSummary> => {
	const groups = new Map<string, RunScore[]>()
	for (const score of scores) {
		const key = keyOf(score)
		const group = groups.get(key)
		if (group) group.push(score)
		else groups.set(key, [score])
	}
	const summaries: Record<string, EvalSummary> = {}
	for (const [key, group] of groups) {
		summaries[key] = summarizeScores(group)
	}
	return summaries
}
