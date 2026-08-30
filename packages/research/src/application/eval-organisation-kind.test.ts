import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	judgeOrganisationKinds,
	type KindCandidate,
	type OrganisationKindJudge,
	type OrganisationKindVerdicts,
	organisationKindPrompt,
	removalAsCandidate,
} from './eval-organisation-kind'
import { organisationKindGuardPrompt } from './organisation-kind-guard'

const row = (name: string, describedAs = ''): KindCandidate => ({
	name,
	describedAs,
})

// A judge that answers from a fixed list of kinds, in the order it is asked, and
// records what it was shown so a test can check it was not asked about rows the
// golden file had already settled.
const judgeSaying = (
	kinds: ReadonlyArray<'company' | 'other' | 'unsure'>,
	seen: KindCandidate[] = [],
) => ({
	seen,
	judge: (rows: ReadonlyArray<KindCandidate>) => {
		seen.push(...rows)
		return Effect.succeed({
			verdicts: kinds.map((kind, index) => ({ index, kind })),
		} satisfies OrganisationKindVerdicts)
	},
})

const decide = (
	rows: ReadonlyArray<KindCandidate>,
	notCompanies: ReadonlyArray<string>,
	judge: OrganisationKindJudge,
) => Effect.runPromise(judgeOrganisationKinds(rows, notCompanies, judge))

describe('deciding what kind of organisation each row is', () => {
	describe('when the golden file names the row', () => {
		it('should settle it without asking, whatever a model would say', async () => {
			// GIVEN a trade body the golden file lists, and a judge that would wrongly
			// call everything a company
			const { judge, seen } = judgeSaying(['company'])
			const kinds = await decide([row('FENIE')], ['FENIE'], judge)

			// WHEN decided — THEN the listed body stays a body, because a person
			// checked that one, and it is never put to the model at all
			expect(kinds).toEqual([{ isCompany: false, method: 'golden-listed' }])
			expect(seen).toEqual([])
		})
	})

	describe('when the model rules on a row', () => {
		it('should drop the ones it calls a body and keep the rest', async () => {
			// GIVEN two rows the golden file says nothing about
			const { judge } = judgeSaying(['other', 'company'])
			const kinds = await decide(
				[row('Asociación Provincial de Instaladores'), row('Elèctrica Puig')],
				[],
				judge,
			)

			// WHEN decided — THEN each carries the model's ruling, marked as judged so
			// a reader can tell which figures rest on a model
			expect(kinds).toEqual([
				{ isCompany: false, method: 'judged', said: expect.any(String) },
				{ isCompany: true, method: 'judged', said: expect.any(String) },
			])
		})

		it('should leave a row it cannot tell about alone', async () => {
			// GIVEN a row too thin to classify
			const { judge } = judgeSaying(['unsure'])
			const kinds = await decide([row('Grupo Delta')], [], judge)

			// WHEN decided — THEN it stays a company, since not knowing is not a
			// reason to call something a fault, but it counts as judged because the
			// model did answer
			expect(kinds).toEqual([
				{ isCompany: true, method: 'judged', said: expect.any(String) },
			])
		})
	})

	describe('when the golden file settles some rows and not others', () => {
		it('should map each ruling back to the row it was about', async () => {
			// GIVEN a listed body sitting between two rows nobody listed, so the model
			// sees a shorter list than the one being decided
			const { judge, seen } = judgeSaying(['company', 'other'])
			const kinds = await decide(
				[row('Elèctrica Puig'), row('FENIE'), row("Gremi d'Instal·ladors")],
				['FENIE'],
				judge,
			)

			// WHEN decided — THEN the model was shown only the two it had to settle,
			// and its answers land on those two rather than being read off by position
			// against the full list
			expect(seen.map(candidate => candidate.name)).toEqual([
				'Elèctrica Puig',
				"Gremi d'Instal·ladors",
			])
			expect(kinds).toEqual([
				{ isCompany: true, method: 'judged', said: expect.any(String) },
				{ isCompany: false, method: 'golden-listed' },
				{ isCompany: false, method: 'judged', said: expect.any(String) },
			])
		})
	})

	describe('when the model cannot be reached', () => {
		it('should leave every row it was asked about a company', async () => {
			// GIVEN a judge that fails outright
			const kinds = await decide(
				[row('Elèctrica Puig'), row('FENIE')],
				['FENIE'],
				() => Effect.die('the model is down'),
			)

			// WHEN decided — THEN the reading falls back to what it was before a model
			// was involved: the golden file's body still counts, and nothing else is
			// called a fault. An outage must not read as a list full of trade bodies.
			expect(kinds).toEqual([
				{ isCompany: true, method: 'unjudged' },
				{ isCompany: false, method: 'golden-listed' },
			])
		})

		it('should leave a row the model skipped alone', async () => {
			// GIVEN a judge that answers about the first row only
			const { judge } = judgeSaying(['other'])
			const kinds = await decide(
				[row('Gremi de Fusters'), row('Fusteria Roca')],
				[],
				judge,
			)

			// WHEN decided — THEN the unanswered row is unjudged rather than assumed,
			// so a partial answer cannot quietly become a verdict
			expect(kinds).toEqual([
				{ isCompany: false, method: 'judged', said: expect.any(String) },
				{ isCompany: true, method: 'unjudged' },
			])
		})
	})

	describe('when the golden file settles every row', () => {
		it('should not call the model at all', async () => {
			// GIVEN two rows, both listed
			const { judge, seen } = judgeSaying(['company', 'company'])
			const kinds = await decide(
				[row('FENIE'), row('UNEF')],
				['FENIE', 'UNEF'],
				judge,
			)

			// WHEN decided — THEN nothing is asked, so a pass over a fully-listed
			// market spends nothing on a model
			expect(seen).toEqual([])
			expect(kinds.every(kind => kind.method === 'golden-listed')).toBe(true)
		})
	})
})

describe('the question put to the model', () => {
	describe('when a row could be a company or a supplier to the trade', () => {
		it('should place a supplier to the trade with the organisations that are not companies', () => {
			// GIVEN the question as it is asked
			const prompt = organisationKindPrompt([row('GeoTapp', 'Software')])
			const other = prompt
				.split('\n')
				.find(line => line.trim().startsWith('"other"'))

			// WHEN the "other" answer is read
			// THEN a firm whose customers are the trade belongs to it. Left off, a
			// vendor selling to installers reads as an installer, and the figure
			// meant to catch it scores the list clean.
			expect(other).toBeDefined()
			expect(other).toMatch(/customers are the trade/i)
		})

		it('should not offer "supplies" as a bare mark of a company', () => {
			// GIVEN the question as it is asked
			const prompt = organisationKindPrompt([row('GeoTapp', 'Software')])
			const company = prompt
				.split('\n')
				.find(line => line.trim().startsWith('"company"'))

			// WHEN the "company" answer is read
			// THEN it does not claim supplying as the trade's own work: every firm
			// supplies somebody, so the word placed a vendor on the wrong side.
			expect(company).toBeDefined()
			expect(company).not.toMatch(/supplies/i)
		})
	})

	describe('when held against the check it measures', () => {
		it('should ask in different words from the pipeline it grades', () => {
			// GIVEN both questions over the same row
			const candidate = {
				id: 'r0',
				name: 'GeoTapp',
				describedAs: 'Software',
				websiteHost: '',
			}

			// WHEN each is put together
			// THEN they are not the same text. An instrument that asked exactly as
			// the thing it measures could never catch that thing being wrong, so the
			// two are kept apart on purpose rather than shared.
			expect(organisationKindPrompt([row('GeoTapp', 'Software')])).not.toBe(
				organisationKindGuardPrompt([candidate]),
			)
		})
	})
})

describe('putting a removed row to the judge', () => {
	describe('when the run recorded why it removed the row', () => {
		it('should show the judge the row own words and never the verdict', () => {
			// GIVEN a removal carrying both the row's words and the reason it went
			const candidate = removalAsCandidate({
				name: 'Cronoshare Fontaneros',
				reason: 'quotes marketplace',
				describedAs: 'Cronoshare marketing page mentions plumbing services',
			})

			// WHEN it is put to the judge
			// THEN it carries the row's words. The reason is this check's own answer,
			//   phrased in the words the judge's "other" bucket already lists, so
			//   handing it over would tell the judge what to say and the figure would
			//   agree with the thing it exists to disagree with.
			expect(candidate.describedAs).toBe(
				'Cronoshare marketing page mentions plumbing services',
			)
			expect(candidate.describedAs).not.toContain('marketplace')
			expect(JSON.stringify(candidate)).not.toContain('quotes marketplace')
		})

		it('should show nothing rather than the fallback reason for a row that said nothing', () => {
			// GIVEN a row the run removed without the model offering words for it
			const candidate = removalAsCandidate({
				name: 'Unknown SL',
				reason: 'not a company of this trade',
				describedAs: '',
			})

			// WHEN it is put to the judge
			// THEN it goes as a bare name. The fallback reason states the conclusion
			//   outright, so a judge shown it could only ever agree.
			expect(candidate).toEqual({ name: 'Unknown SL', describedAs: '' })
		})
	})
})
