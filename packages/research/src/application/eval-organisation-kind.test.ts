import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	judgeOrganisationKinds,
	type KindCandidate,
	type OrganisationKindJudge,
	type OrganisationKindVerdicts,
} from './eval-organisation-kind'

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
				{ isCompany: false, method: 'judged' },
				{ isCompany: true, method: 'judged' },
			])
		})

		it('should leave a row it cannot tell about alone', async () => {
			// GIVEN a row too thin to classify
			const { judge } = judgeSaying(['unsure'])
			const kinds = await decide([row('Grupo Delta')], [], judge)

			// WHEN decided — THEN it stays a company, since not knowing is not a
			// reason to call something a fault, but it counts as judged because the
			// model did answer
			expect(kinds).toEqual([{ isCompany: true, method: 'judged' }])
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
				{ isCompany: true, method: 'judged' },
				{ isCompany: false, method: 'golden-listed' },
				{ isCompany: false, method: 'judged' },
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
				{ isCompany: false, method: 'judged' },
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
