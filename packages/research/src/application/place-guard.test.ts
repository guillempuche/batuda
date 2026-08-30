import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
	markRowsOutsidePlace,
	type PlaceGuardJudge,
	type PlaceVerdictType,
	type RememberedPlace,
} from './place-guard'
import { OUTSIDE_REQUESTED_PLACE } from './row-marks'

const TEXAS = 'Texas, United States'

const prospect = (
	name: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	name,
	why_relevant: 'auto repair',
	citations: [{ source_id: 'https://example.test/a', confidence: null }],
	...extra,
})

const scan = (rows: ReadonlyArray<unknown>) => ({ prospects: rows })

const rowsOf = (findings: unknown): Array<Record<string, unknown>> =>
	(findings as { prospects: Array<Record<string, unknown>> }).prospects

const namesOf = (findings: unknown): string[] =>
	rowsOf(findings).map(row => String(row['name']))

/** Which rows came back wearing the mark. */
const markedNames = (findings: unknown): string[] =>
	rowsOf(findings)
		.filter(row => {
			const marks = row['marks']
			return Array.isArray(marks) && marks.includes(OUTSIDE_REQUESTED_PLACE)
		})
		.map(row => String(row['name']))

/**
 * A judge that rules by NAME rather than by position, so a test never depends on
 * the order the walk happens to read the list in.
 */
const rules =
	(byName: Record<string, PlaceVerdictType>): PlaceGuardJudge<never, never> =>
	(_place, rows) =>
		Effect.succeed({
			verdicts: rows.flatMap(row => {
				const where = byName[row.name]
				return where === undefined ? [] : [{ id: row.id, where }]
			}),
		})

/** What the caller hands back when the model call failed: an answer with nothing in it. */
const silent: PlaceGuardJudge<never, never> = () =>
	Effect.succeed({ verdicts: [] })

const run = <A>(effect: Effect.Effect<A, never, never>): Promise<A> =>
	Effect.runPromise(effect)

describe('markRowsOutsidePlace', () => {
	describe("when the request names one state and a row's evidence names another", () => {
		it('should mark that row and leave the one inside alone', async () => {
			// GIVEN a scan asked for Texas, one company whose evidence puts it in
			// Nevada, and one genuinely in a Texas town. This is the shape the eight
			// scans of 29 August returned: nothing in the chain asked where a company
			// was, so the Nevada row shipped indistinguishable from the rest
			const findings = scan([
				prospect('Premium Auto Care', {
					location: 'Reno, Nevada',
					website: 'https://premiumautocarereno.com',
				}),
				prospect('Katy Collision', { location: 'Katy, Texas' }),
			])

			// WHEN the run is judged against the area it asked about
			const result = await run(
				markRowsOutsidePlace(
					findings,
					'prospects',
					TEXAS,
					rules({
						'Premium Auto Care': 'outside',
						'Katy Collision': 'inside',
					}),
				),
			)

			// THEN the Nevada row wears the mark and the Texas row does not — and
			// both are still on the list, because a company working across a border
			// is ambiguous rather than wrong
			expect(namesOf(result.findings)).toEqual([
				'Premium Auto Care',
				'Katy Collision',
			])
			expect(markedNames(result.findings)).toEqual(['Premium Auto Care'])
			expect(result.marked).toHaveLength(1)
			expect(result.asked).toBe(2)
			expect(result.ruled).toBe(2)
		})

		it('should give the mark a reason even when the judge offered none', async () => {
			// GIVEN a judge that rules outside without saying why
			const findings = scan([prospect('Far Away', { location: 'Utah' })])

			// WHEN judged — THEN the mark still carries something a reader can weigh,
			// because unlike a dropped row this one stays and somebody has to decide
			const result = await run(
				markRowsOutsidePlace(
					findings,
					'prospects',
					TEXAS,
					rules({ 'Far Away': 'outside' }),
				),
			)
			expect(result.marked[0]?.reason).not.toBe('')
		})
	})

	describe('when the judge cannot place a row', () => {
		it('should keep it unmarked and count it apart', async () => {
			// GIVEN a judge unsure about the row
			const findings = scan([prospect('Maybe Co', { location: 'Springfield' })])

			// WHEN judged — THEN nothing is marked, and the count separates "could
			// not place" from "placed inside": a judge rerouted to a weaker model
			// answers unclear to everything, which marks nothing and would otherwise
			// read exactly like a clean list
			const result = await run(
				markRowsOutsidePlace(
					findings,
					'prospects',
					TEXAS,
					rules({ 'Maybe Co': 'unclear' }),
				),
			)
			expect(markedNames(result.findings)).toEqual([])
			expect(result.ruled).toBe(1)
			expect(result.unclear).toBe(1)
		})
	})

	describe('when the judge answers nothing at all', () => {
		it('should keep every row, and say the check did not run', async () => {
			// GIVEN the answer a caller hands back after a failed model call
			const findings = scan([
				prospect('One', { location: 'Reno, Nevada' }),
				prospect('Two', { location: 'Utah' }),
			])

			// WHEN judged — THEN no row is marked, and `asked` against `ruled` is what
			// tells this apart from a list that was read and found clean
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, silent),
			)
			expect(markedNames(result.findings)).toEqual([])
			expect(result.asked).toBe(2)
			expect(result.ruled).toBe(0)
		})
	})

	describe('when a verdict names a row nobody was asked about', () => {
		it('should change nothing', async () => {
			// GIVEN a judge inventing an id
			const findings = scan([prospect('Real', { location: 'Dallas, Texas' })])
			const inventing: PlaceGuardJudge<never, never> = () =>
				Effect.succeed({
					verdicts: [{ id: 'r99', where: 'outside' as const }],
				})

			// WHEN judged — THEN nothing is marked: a verdict tied to no row acts on
			// no row
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, inventing),
			)
			expect(markedNames(result.findings)).toEqual([])
		})
	})

	describe('when the request named no place', () => {
		it('should not ask at all', async () => {
			// GIVEN a scan with no area to hold a row to
			const findings = scan([prospect('Anywhere Co', { location: 'Utah' })])
			const judge = vi.fn(silent)

			// WHEN run with an empty area — THEN the judge is never called and no row
			// is marked. Nothing was asked, so nothing can be out of place
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', '   ', judge),
			)
			expect(judge).not.toHaveBeenCalled()
			expect(markedNames(result.findings)).toEqual([])
			expect(result.asked).toBe(0)
		})
	})

	describe('when a row states nothing about where it is', () => {
		it('should keep it without asking — silence is not a conflict', async () => {
			// GIVEN a row with no place, no country, no site and nothing cited
			const findings = scan([
				{ name: 'Bare', why_relevant: 'auto repair', citations: [] },
			])
			const judge = vi.fn(silent)

			// WHEN judged — THEN it is neither asked about nor marked: a judge given
			// nothing could only guess, and guessing is what marks somebody else's
			// company
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, judge),
			)
			expect(judge).not.toHaveBeenCalled()
			expect(markedNames(result.findings)).toEqual([])
		})
	})

	describe('when the location names a service area rather than a place', () => {
		it('should remove it, with no judge involved', async () => {
			// GIVEN the value a Reno company came back with in a Houston scan: the
			// area asked for, then every town around it. A prospect's location is a
			// bare string, so the rule that already refuses this shape had never been
			// able to reach the field
			const findings = scan([
				prospect('Premium Auto Care', {
					location:
						'Greater Houston, Texas (Houston, Katy, Sugar Land, The Woodlands, Pearland, Pasadena, Spring)',
				}),
			])
			const judge = vi.fn(silent)

			// WHEN run — THEN the claim is gone, and it took no model to say so
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, judge),
			)
			expect(rowsOf(result.findings)[0]?.['location']).toBeUndefined()
			expect(result.locationsDropped).toBe(1)
		})

		it('should read a place that names the page it was read on', async () => {
			// GIVEN the shape the scan schema now produces — the place paired with
			// its source. Every other fixture here writes it bare, which is the
			// shape the pipeline stopped producing, and reading only that is how
			// four readers of the website field went quiet for three weeks without
			// a single test noticing
			const findings = scan([
				prospect('Premium Auto Care', {
					location: {
						value:
							'Greater Houston, Texas (Houston, Katy, Sugar Land, The Woodlands, Pearland, Pasadena, Spring)',
						source_id: 'https://premiumautocarereno.com',
						confidence: null,
					},
				}),
			])

			// WHEN run — THEN the gate reaches through the pairing and removes it
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, silent),
			)
			expect(rowsOf(result.findings)[0]?.['location']).toBeUndefined()
			expect(result.locationsDropped).toBe(1)
		})

		it('should leave a long address and a folded branch list alone', async () => {
			// GIVEN a real five-part Spanish address, and what the fold writes when a
			// company's branch offices are merged onto it — joined with semicolons on
			// purpose, because one place already carries commas
			const findings = scan([
				prospect('Igualada SL', {
					location:
						'Pol. Ind. Les Comes, C/ Anoia 12, Igualada, Barcelona, Spain',
				}),
				prospect('Agences SA', {
					location: 'Montpellier; Lyon; Douains; Longueau; Lille; Nantes',
				}),
			])

			// WHEN run — THEN both keep their location: naming one place at length,
			// or several the fold gathered, is not the same as listing a service area
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, silent),
			)
			expect(result.locationsDropped).toBe(0)
			expect(rowsOf(result.findings)[0]?.['location']).toContain('Igualada')
			expect(rowsOf(result.findings)[1]?.['location']).toContain('Montpellier')
		})
	})

	describe('when an earlier pass already placed a company', () => {
		it('should stand by an inside even after the row gains evidence', async () => {
			// GIVEN a company placed inside on an earlier pass, met again with a
			// location the gap round has since filled in
			const remembered = new Map<string, RememberedPlace>([
				['acmefleet', { where: 'inside' }],
			])
			const findings = scan([
				prospect('Acme Fleet', { location: 'Fort Worth, Texas' }),
			])
			const judge = vi.fn(silent)

			// WHEN judged — THEN it is not bought again. Where a company is does not
			// stop being true because the run learned more about it
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, judge, remembered),
			)
			expect(judge).not.toHaveBeenCalled()
			expect(markedNames(result.findings)).toEqual([])
		})

		it('should not mark on a superseded answer when the re-ask comes back empty', async () => {
			// GIVEN a company ruled outside on thin evidence, and met again with the
			// address a gap round has since found. The re-ask happens — and returns
			// nothing for this row, which is what a short batch or a caught failure
			// looks like
			const remembered = new Map<string, RememberedPlace>([
				[
					'acmefleet',
					{
						where: 'outside',
						reason: 'listed under Utah',
						evidence: '||utahdirectory.test|',
					},
				],
			])
			const findings = scan([
				prospect('Acme Fleet', { location: 'Fort Worth, Texas' }),
			])

			// WHEN judged — THEN the row is NOT marked. The answer being re-asked is
			// the one the memory holds, so applying it would badge a Fort Worth
			// company as outside Texas on evidence the run has already replaced
			const result = await run(
				markRowsOutsidePlace(findings, 'prospects', TEXAS, silent, remembered),
			)
			expect(markedNames(result.findings)).toEqual([])
			// AND it does not count as ruled, so a judge that answers nothing still
			// shows as one that answered nothing
			expect(result.ruled).toBe(0)
		})

		it('should take the mark back off once the run can place the company inside', async () => {
			// GIVEN a row an earlier pass marked, met again after a gap round filled
			// in its address
			const findings = scan([
				{
					name: 'Acme Fleet',
					why_relevant: 'fleet',
					location: 'Fort Worth, Texas',
					citations: [{ source_id: 'https://acmefleetdfw.test/' }],
					marks: ['outside_requested_place'],
					outside_place_reason: 'listed under Utah',
				},
			])

			// WHEN this pass rules it inside
			const result = await run(
				markRowsOutsidePlace(
					findings,
					'prospects',
					TEXAS,
					rules({ 'Acme Fleet': 'inside' }),
				),
			)

			// THEN the badge and its reason come off. The memory loosens as evidence
			// grows, and the row has to loosen with it — otherwise the run pays a
			// gap round for a better answer and then ships the worse one
			const row = rowsOf(result.findings)[0]
			expect(row?.['marks']).toBeUndefined()
			expect(row?.['outside_place_reason']).toBeUndefined()
			expect(result.cleared).toBe(1)
		})

		it('should ask again about an outside once the row gains evidence', async () => {
			// GIVEN a company ruled outside on an earlier pass, when it had no
			// location at all, and met again with the address the gap round then
			// found. This is the whole reason the memory runs the opposite way to the
			// organisation-kind check: a company is inside if any of its places is,
			// so more evidence can only ever soften this answer
			const remembered = new Map<string, RememberedPlace>([
				['acmefleet', { where: 'outside', evidence: '||utahdirectory.test|' }],
			])
			const findings = scan([
				prospect('Acme Fleet', { location: 'Fort Worth, Texas' }),
			])

			// WHEN judged — THEN it is asked afresh and the new answer stands, rather
			// than the run throwing away the search it just paid for
			const result = await run(
				markRowsOutsidePlace(
					findings,
					'prospects',
					TEXAS,
					rules({ 'Acme Fleet': 'inside' }),
					remembered,
				),
			)
			expect(markedNames(result.findings)).toEqual([])
			expect(result.ruled).toBe(1)
		})
	})

	describe('when the run has spent the time it set aside for this', () => {
		it('should stop asking and keep every row', async () => {
			// GIVEN a list to judge and a run already past its margin. The clock is
			// read before each question rather than once before them all, because a
			// long list is several questions and passing the whole-run deadline does
			// not degrade a run — it replaces everything it found with an error
			const findings = scan([
				prospect('One', { location: 'Reno, Nevada' }),
				prospect('Two', { location: 'Utah' }),
			])
			const judge = vi.fn(rules({ One: 'outside', Two: 'outside' }))

			// WHEN judged with no time left
			const result = await run(
				markRowsOutsidePlace(
					findings,
					'prospects',
					TEXAS,
					judge,
					new Map(),
					() => true,
				),
			)

			// THEN nobody is asked and nothing is marked — a list that was not
			// finished, rather than a run that was lost
			expect(judge).not.toHaveBeenCalled()
			expect(markedNames(result.findings)).toEqual([])
		})
	})

	describe('when the findings are not the shape a scan returns', () => {
		it('should pass them through rather than throwing', async () => {
			// GIVEN findings that are a bare string
			const result = await run(
				markRowsOutsidePlace('not findings', 'prospects', TEXAS, silent),
			)
			expect(result.findings).toBe('not findings')
			expect(result.marked).toEqual([])
		})

		it('should pass through a run that is not a scan', async () => {
			// GIVEN an enrichment run, which has no list of companies nobody vouched for
			const findings = scan([prospect('Anything', { location: 'Utah' })])
			const result = await run(
				markRowsOutsidePlace(findings, undefined, TEXAS, silent),
			)
			expect(result.findings).toBe(findings)
			expect(result.asked).toBe(0)
		})
	})
})
