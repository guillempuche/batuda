import { describe, expect, it } from 'vitest'

import { clearFieldOnlyDoubt } from './unconfirmed-mark-guard'

const scan = (
	prospects: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> => ({ prospects })

const marksOf = (findings: unknown): Array<unknown> =>
	(findings as { prospects: Array<Record<string, unknown>> }).prospects.map(
		row => row['unconfirmed_reason'],
	)

describe('clearFieldOnlyDoubt', () => {
	describe('when the reason names nothing but the blank columns', () => {
		it('should take the mark back, in whichever language it was written', () => {
			// GIVEN the two shapes a run actually came back with
			const findings = scan([
				{ name: 'Acme', unconfirmed_reason: 'no website, no employee figure' },
				{
					name: 'Beta',
					unconfirmed_reason: 'Número de empleados no confirmado',
				},
			])

			// WHEN checked
			// THEN both marks go. Naming a blank column is not doubt about whether the
			// company is real, and a mark on nearly every row tells a reader nothing
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, undefined])
			expect(result.cleared).toBe(2)
		})

		it('should take it back when every part of a long list is a blank field', () => {
			// GIVEN a reason listing three gaps at once
			const findings = scan([
				{
					name: 'Acme',
					unconfirmed_reason:
						'no website, no location, no employee figure and no autonomous community',
				},
			])

			// WHEN checked — THEN the joining words break the list up as the commas do
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined])
		})

		it('should drop the mark rather than leave it empty', () => {
			// GIVEN a marked row carrying its other fields
			const findings = scan([
				{
					name: 'Acme',
					why_relevant: 'Installer.',
					unconfirmed_reason: 'no website',
				},
			])

			// WHEN checked
			// THEN the row reads as one nobody ever marked, and nothing else moves
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(
				(result.findings as { prospects: Array<Record<string, unknown>> })
					.prospects[0],
			).toEqual({ name: 'Acme', why_relevant: 'Installer.' })
		})
	})

	describe('when the reason is about the company itself', () => {
		it('should keep a mark that no field word accounts for', () => {
			// GIVEN doubt of the kind the mark exists for
			const findings = scan([
				{
					name: 'Instalaciones Barreiro',
					unconfirmed_reason:
						'named only on a municipal tender list, no trace in any register',
				},
			])

			// WHEN checked — THEN it stays: this is doubt about the company, which is
			// the one thing the mark is for
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				'named only on a municipal tender list, no trace in any register',
			])
			expect(result.cleared).toBe(0)
		})

		it('should keep a mark where only part of it reads as a blank field', () => {
			// GIVEN a reason that names a gap AND says something about the company
			const findings = scan([
				{
					name: 'Acme',
					unconfirmed_reason:
						'no website, and the address on the directory belongs to another company',
				},
			])

			// WHEN checked
			// THEN it stays whole. One part being a blank column does not make the rest
			// of it so, and taking the mark away would take the rest with it
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(result.cleared).toBe(0)
		})
	})

	describe('when a later round has filled the column the reason names', () => {
		it('should still take the mark back', () => {
			// GIVEN rows whose reason names a gap that has since been closed — the
			// commonest shape there is, because a round that goes looking for a
			// company's missing facts runs after the reason was written
			const findings = scan([
				{
					name: 'Acme',
					website: 'https://acme.es',
					unconfirmed_reason: 'no website',
				},
				{
					name: 'Beta',
					employee_estimate: { value: 42, source_id: 'https://beta.es' },
					unconfirmed_reason: 'no employee figure',
				},
			])

			// WHEN checked
			// THEN both go. A reason describing a gap that is no longer there was never
			// about whether the company is real, and leaving it would hold back the
			// vouching step over a column that is now filled in
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, undefined])
			expect(result.cleared).toBe(2)
		})
	})

	describe('when there is no mark to judge', () => {
		it('should leave a row that carries none alone', () => {
			// GIVEN a confirmed company
			const findings = scan([{ name: 'Acme', website: 'https://acme.es' }])

			// WHEN checked — THEN nothing changes
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(result.cleared).toBe(0)
			expect(marksOf(result.findings)).toEqual([undefined])
		})

		it('should keep a mark that says nothing at all', () => {
			// GIVEN a reason that is blank or only punctuation
			const findings = scan([
				{ name: 'Acme', unconfirmed_reason: '   ' },
				{ name: 'Beta', unconfirmed_reason: '—' },
			])

			// WHEN checked
			// THEN both stay. Nothing in them names a field, so there is no ground to
			// call them the row reading itself back
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(result.cleared).toBe(0)
		})

		it('should pass a run through untouched when it has no list', () => {
			// GIVEN a run about one named company
			const findings = { enrichment: { industry: 'electrical' } }

			// WHEN checked with no list field — THEN nothing is read
			const result = clearFieldOnlyDoubt(findings, undefined)
			expect(result.findings).toBe(findings)
			expect(result.cleared).toBe(0)
		})

		it('should leave findings that are null or a bare value untouched', () => {
			// GIVEN non-object findings
			// WHEN checked — THEN they pass straight through
			expect(clearFieldOnlyDoubt(null, 'prospects').findings).toBeNull()
			expect(clearFieldOnlyDoubt('text', 'prospects').findings).toBe('text')
		})
	})
})
