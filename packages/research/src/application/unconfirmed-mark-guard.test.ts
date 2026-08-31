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

		it('should take back a mark that says nothing at all', () => {
			// GIVEN a reason that is blank or only punctuation — a shape real runs do
			// produce, having filled the field and then written nothing in it
			const findings = scan([
				{ name: 'Acme', unconfirmed_reason: '   ' },
				{ name: 'Beta', unconfirmed_reason: '—' },
			])

			// WHEN checked
			// THEN both go. A mark with no cause behind it is the worst of both: the
			// row is flagged and held back from being vouched for, and the reader is
			// given nothing to weigh
			const result = clearFieldOnlyDoubt(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, undefined])
			expect(result.cleared).toBe(2)
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

describe('a doubt written in letters this check has no words for', () => {
	const rowWith = (reason: string) => ({
		companies: [{ name: 'X', unconfirmed_reason: reason }],
	})

	describe('when the reason is written in a non-Latin alphabet', () => {
		it('should keep the mark rather than take it off unread', () => {
			// GIVEN the same doubt written in four alphabets this check holds no
			// vocabulary for
			const reasons = [
				'未找到该公司的网站和电话',
				'Не найден сайт компании',
				'لم يتم العثور على موقع الشركة',
				'회사 웹사이트를 찾을 수 없습니다',
			]

			// WHEN each row is checked
			// THEN the mark stays on every one. Reading only a-z gave no words at all,
			// and no words was read as "this names no cause" — so the mark came off
			// precisely the rows nobody had managed to confirm
			for (const reason of reasons) {
				const result = clearFieldOnlyDoubt(rowWith(reason), 'companies')
				expect(result.cleared).toBe(0)
				const kept = (result.findings as { companies: Array<object> })
					.companies[0]
				expect(kept).toHaveProperty('unconfirmed_reason', reason)
			}
		})

		it('should count them, so a run cannot report a check it never made', () => {
			// GIVEN two rows doubted in Chinese and one in English naming its own gaps
			const findings = {
				companies: [
					{ name: 'A', unconfirmed_reason: '未找到该公司的网站' },
					{ name: 'B', unconfirmed_reason: '未找到该公司的电话' },
					{ name: 'C', unconfirmed_reason: 'no website, no employee figure' },
				],
			}

			// WHEN checked
			// THEN the two nobody could read are counted apart from the one that was
			// read and cleared — a silent skip and a stated one differ only if the
			// stated one is counted somewhere
			const result = clearFieldOnlyDoubt(findings, 'companies')
			expect(result.unreadable).toBe(2)
			expect(result.cleared).toBe(1)
		})
	})

	describe('when the reason mixes a non-Latin name with wording it can read', () => {
		it('should treat it exactly as it treats a Latin name in the same place', () => {
			// GIVEN the same reason twice, naming a company the row has no website
			// for — once in Latin letters and once in Chinese
			const latin = clearFieldOnlyDoubt(
				rowWith('no website for Acme SL, no employee figure'),
				'companies',
			)
			const chinese = clearFieldOnlyDoubt(
				rowWith('no website for 北京科技, no employee figure'),
				'companies',
			)

			// WHEN both are checked
			// THEN they answer the same. A named company is a word the row's own
			// columns cannot account for either way, so the mark stays either way —
			// and the reason is read rather than skipped, so neither counts as unread
			expect(chinese.cleared).toBe(latin.cleared)
			expect(chinese.unreadable).toBe(latin.unreadable)
			expect(chinese.cleared).toBe(0)
			expect(chinese.unreadable).toBe(0)
		})
	})

	describe('when the reason says something real in a non-Latin alphabet', () => {
		it('should keep the mark, the same as it would in English', () => {
			// GIVEN a doubt that is about the company rather than about blank columns
			const result = clearFieldOnlyDoubt(
				rowWith('该公司已于2019年注销'),
				'companies',
			)

			// WHEN checked
			// THEN the mark stays. The safe answer is the same either way — what
			// changes is that this one is now counted as unread rather than cleared
			expect(result.cleared).toBe(0)
			expect(result.unreadable).toBe(1)
		})
	})
})
