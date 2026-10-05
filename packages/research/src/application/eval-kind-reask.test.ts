import { readFileSync } from 'node:fs'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	type KindReaskScore,
	type KindRun,
	parseKindCorpus,
	parseKindRun,
	removedFromRun,
	scoreKindReask,
	spreadOf,
} from './eval-kind-reask'
import type { OrganisationKindGuardJudge } from './organisation-kind-guard'

const makers: KindRun = {
	id: 'makers-1',
	request: 'Makers of precast concrete for warehouses',
	requestKind: 'makers',
	rows: [
		{
			name: 'Prefabricats Exemple',
			describedAs: 'Manufactures concrete modules',
			websiteHost: 'prefabricats.example',
			label: 'company',
		},
		{
			name: 'Gremi de Constructors',
			describedAs: 'Trade association of builders',
			websiteHost: null,
			label: 'other',
		},
		{
			name: 'Panells Exemple',
			describedAs: 'Supplies concrete panels',
			websiteHost: 'panells.example',
			label: null,
		},
	],
}

// A judge that calls "other" every row whose name is on its list, and says
// nothing of the rest — which the check reads as leave it alone.
const judgeCalling =
	(others: ReadonlyArray<string>): OrganisationKindGuardJudge<never, never> =>
	rows =>
		Effect.succeed({
			verdicts: rows
				.filter(row => others.includes(row.name))
				.map(row => ({ id: row.id, kind: 'other' as const, reason: 'listed' })),
		})

describe('parseKindRun', () => {
	describe('when a run is written out in full', () => {
		it('should carry it through, its texts trimmed', () => {
			// GIVEN a run with a labelled row, an unlabelled one and one with no site
			const result = parseKindRun({
				...makers,
				request: `  ${makers.request}  `,
			})

			// THEN it parses to the same run
			expect(result).toEqual({ ok: true, value: makers })
		})
	})

	describe('when something a re-ask needs is missing or mistyped', () => {
		it('should refuse the run and say what is wrong', () => {
			// GIVEN each way a run can be written wrong
			const firstRow = makers.rows[0]
			const wrong: ReadonlyArray<readonly [string, unknown, string]> = [
				['not an object', 'makers', 'object'],
				['no id', { ...makers, id: ' ' }, 'id'],
				['no request', { ...makers, request: undefined }, 'request'],
				['no sort of request', { ...makers, requestKind: '' }, 'requestKind'],
				['no rows', { ...makers, rows: [] }, 'rows'],
				['a row that is not an object', { ...makers, rows: ['x'] }, 'object'],
				[
					'a nameless row',
					{ ...makers, rows: [{ ...firstRow, name: '' }] },
					'name',
				],
				[
					'a row with no words of its own, not even empty ones',
					{ ...makers, rows: [{ ...firstRow, describedAs: undefined }] },
					'describedAs',
				],
				[
					'a website left out rather than null',
					{ ...makers, rows: [{ ...firstRow, websiteHost: undefined }] },
					'websiteHost',
				],
				[
					'a website written as an address rather than a bare host',
					{
						...makers,
						rows: [
							{ ...firstRow, websiteHost: 'https://prefabricats.example/' },
						],
					},
					'websiteHost',
				],
				[
					'a label in other words',
					{ ...makers, rows: [{ ...firstRow, label: 'supplier' }] },
					'label',
				],
				[
					'one name twice',
					{ ...makers, rows: [firstRow, { ...firstRow, label: 'other' }] },
					'twice',
				],
			]

			for (const [what, run, named] of wrong) {
				const result = parseKindRun(run)
				expect(result.ok, what).toBe(false)
				if (!result.ok) expect(result.error, what).toContain(named)
			}
		})
	})
})

describe('parseKindCorpus', () => {
	describe('when the corpus mixes good and bad runs', () => {
		it('should keep the good ones and give a reason per bad one', () => {
			const { runs, errors } = parseKindCorpus([makers, { id: 'broken' }])
			expect(runs).toEqual([makers])
			expect(errors).toHaveLength(1)
			expect(errors[0]).toContain('broken')
		})
	})

	describe('when two runs share an id', () => {
		it('should say so, since the score is kept per run', () => {
			const { errors } = parseKindCorpus([makers, makers])
			expect(errors).toEqual(['two runs share the id "makers-1"'])
		})
	})

	describe('when the corpus is not a list', () => {
		it('should refuse it', () => {
			expect(parseKindCorpus({ runs: [] }).errors).toHaveLength(1)
		})
	})
})

describe('parseKindCorpus — the shipped example', () => {
	describe('when parsing kind-rows.example.json', () => {
		it('should parse every run, and name only made-up firms', () => {
			// GIVEN the example the re-ask's help and README point at
			const raw: unknown = JSON.parse(
				readFileSync(
					new URL('../../../../eval/kind-rows.example.json', import.meta.url),
					'utf8',
				),
			)

			// WHEN parsed
			const { runs, errors } = parseKindCorpus(raw)

			// THEN nothing is refused, more than one sort of request is shown, and a
			// row of each label and an unlabelled one are there to copy
			expect(errors).toEqual([])
			expect(new Set(runs.map(run => run.requestKind)).size).toBeGreaterThan(1)
			const labels = runs.flatMap(run => run.rows.map(row => row.label))
			expect(labels).toEqual(expect.arrayContaining(['company', 'other', null]))
			// AND every site is on a host nobody can own, since calling a real firm
			// "not a company" in a shared file is a claim about that firm
			for (const run of runs)
				for (const row of run.rows)
					if (row.websiteHost !== null)
						expect(row.websiteHost).toMatch(/\.example$/)
		})
	})
})

describe('removedFromRun', () => {
	describe('when the judge calls some rows other', () => {
		it('should name exactly those, asked through the check a run uses', async () => {
			// GIVEN a judge that strikes the association and the maker
			const removed = await Effect.runPromise(
				removedFromRun(
					makers,
					judgeCalling(['Gremi de Constructors', 'Prefabricats Exemple']),
				),
			)

			// THEN both are removed and the third row stays
			expect([...removed].sort()).toEqual([
				'Gremi de Constructors',
				'Prefabricats Exemple',
			])
		})
	})

	describe('when the judge answers for nobody', () => {
		it('should remove nobody', async () => {
			const removed = await Effect.runPromise(
				removedFromRun(makers, judgeCalling([])),
			)
			expect(removed.size).toBe(0)
		})
	})

	describe('when the judge sees the rows', () => {
		it('should be shown each row’s own words and the host it gave', async () => {
			// GIVEN a judge that records what it is handed
			const seen: Array<{ name: string; describedAs: string; host: string }> =
				[]
			const recording: OrganisationKindGuardJudge<never, never> = rows => {
				for (const row of rows)
					seen.push({
						name: row.name,
						describedAs: row.describedAs,
						host: row.websiteHost,
					})
				return Effect.succeed({ verdicts: [] })
			}

			// WHEN the run is asked
			await Effect.runPromise(removedFromRun(makers, recording))

			// THEN every row arrived with its words, and a row with no site with none
			expect(seen).toContainEqual({
				name: 'Prefabricats Exemple',
				describedAs: 'Manufactures concrete modules',
				host: 'prefabricats.example',
			})
			expect(seen).toContainEqual({
				name: 'Gremi de Constructors',
				describedAs: 'Trade association of builders',
				host: '',
			})
			expect(seen).toHaveLength(3)
		})
	})
})

describe('scoreKindReask', () => {
	const installers: KindRun = {
		id: 'installers-1',
		request: 'Electrical installers',
		requestKind: 'installers',
		rows: [
			{
				name: 'Instal Exemple',
				describedAs: '',
				websiteHost: null,
				label: 'company',
			},
			{
				name: 'Directori Exemple',
				describedAs: '',
				websiteHost: null,
				label: 'other',
			},
		],
	}

	describe('when the check removed a firm of the kind asked for and kept a body', () => {
		it('should name both mistakes, per sort of request and over all', () => {
			// GIVEN the makers run with its maker struck off and its association
			// kept, and an installers run handled right
			const score = scoreKindReask(
				[makers, installers],
				new Map([
					['makers-1', new Set(['Prefabricats Exemple', 'Panells Exemple'])],
					['installers-1', new Set(['Directori Exemple'])],
				]),
			)

			// THEN the makers carry both mistakes and the installers none, and the
			// unlabelled row is counted apart whatever was done to it
			expect(score.byRequestKind['makers']).toEqual({
				labelled: 2,
				unlabelled: 1,
				companies: 1,
				others: 1,
				wronglyRemoved: ['makers-1: Prefabricats Exemple'],
				wronglyKept: ['makers-1: Gremi de Constructors'],
			})
			expect(score.byRequestKind['installers']?.wronglyRemoved).toEqual([])
			expect(score.byRequestKind['installers']?.wronglyKept).toEqual([])
			expect(score.overall.labelled).toBe(4)
			expect(score.overall.wronglyRemoved).toHaveLength(1)
		})
	})

	describe('when a run was never asked', () => {
		it('should read it as nothing removed', () => {
			const score = scoreKindReask([makers], new Map())
			expect(score.overall.wronglyRemoved).toEqual([])
			expect(score.overall.wronglyKept).toEqual([
				'makers-1: Gremi de Constructors',
			])
		})
	})

	describe('when there are no runs', () => {
		it('should score nought and no sorts', () => {
			const score = scoreKindReask([], new Map())
			expect(score.overall.labelled).toBe(0)
			expect(score.byRequestKind).toEqual({})
		})
	})
})

describe('spreadOf', () => {
	const asking = (removed: number, kept: number): KindReaskScore => ({
		labelled: 10,
		unlabelled: 0,
		companies: 5,
		others: 5,
		wronglyRemoved: Array.from({ length: removed }, (_, n) => `r${n}`),
		wronglyKept: Array.from({ length: kept }, (_, n) => `k${n}`),
	})

	describe('when the same corpus was asked several times', () => {
		it('should give the least and the most of each count', () => {
			expect(spreadOf([asking(2, 1), asking(4, 1), asking(3, 0)])).toEqual({
				wronglyRemoved: { least: 2, most: 4 },
				wronglyKept: { least: 0, most: 1 },
			})
		})
	})

	describe('when it was asked once', () => {
		it('should give a range of nothing', () => {
			expect(spreadOf([asking(2, 1)])).toEqual({
				wronglyRemoved: { least: 2, most: 2 },
				wronglyKept: { least: 1, most: 1 },
			})
		})
	})

	describe('when it was never asked', () => {
		it('should give nothing rather than a range of infinities', () => {
			expect(spreadOf([])).toBeNull()
		})
	})
})
