import { describe, expect, it } from 'vitest'

import { markNameOnlyRows, NAME_ONLY_EVIDENCE } from './name-only-guard'

const scan = (
	prospects: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> => ({ prospects })

const cite = (page: string): Record<string, unknown> => ({
	source_id: page,
	quote: 'Liste des professionnels',
})

const marksOf = (findings: unknown): Array<unknown> =>
	(
		findings as { prospects: Array<Record<string, unknown> | null> }
	).prospects.map(row => row?.['unconfirmed_evidence'])

describe('markNameOnlyRows', () => {
	describe('when a row is a name off a page that lists many companies', () => {
		it('should mark it, because there is nothing else the page could give', () => {
			// GIVEN one directory index cited for three rows, none of which carries a
			// site or a place — the shape a live French market search came back with
			const findings = scan([
				{ name: 'DAMAD', citations: [cite('https://pj.example/ascensoriste')] },
				{
					name: 'Ascenseurs de Paris',
					citations: [cite('https://pj.example/ascensoriste')],
				},
				{
					name: 'Ariane',
					citations: [cite('https://pj.example/ascensoriste')],
				},
			])

			// WHEN checked
			// THEN all three are marked. A page cited for company after company is a
			// list of names, and a row built from one is a name
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
			])
			expect(result.marked).toBe(3)
		})

		it('should mark a row that cites nothing at all, which is the same case', () => {
			// GIVEN a row with no evidence behind it whatsoever
			const findings = scan([{ name: 'Asc' }, { name: 'Beta', citations: [] }])

			// WHEN checked — THEN both are marked: a row citing nothing has even less
			// standing than one citing a list
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
			])
		})

		it('should mark it only when every page it cites is a shared one', () => {
			// GIVEN a row citing both a directory index and a page about itself
			const findings = scan([
				{
					name: 'Ariane',
					citations: [
						cite('https://pj.example/ascensoriste'),
						cite('https://news.example/ariane-profile'),
					],
				},
				{ name: 'DAMAD', citations: [cite('https://pj.example/ascensoriste')] },
			])

			// WHEN checked
			// THEN only the second is marked. One page about this company alone is the
			// run having looked into it, whatever else it also read
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, NAME_ONLY_EVIDENCE])
		})
	})

	describe('when the row has somewhere to go or somewhere to be', () => {
		it('should leave a row with a site of its own alone', () => {
			// GIVEN two rows off the same market report, one naming its own site
			const findings = scan([
				{
					name: 'Otis',
					website: 'https://otis.com',
					citations: [cite('https://report.example/lifts')],
				},
				{ name: 'KONE', citations: [cite('https://report.example/lifts')] },
			])

			// WHEN checked — THEN only the second. A site is somewhere a reader can go
			// and find out more, which is exactly what the marked row lacks
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, NAME_ONLY_EVIDENCE])
		})

		it('should leave a row alone when the shared page printed its place', () => {
			// GIVEN a directory page that lists companies WITH their towns, so two rows
			// share it and both come away with somewhere to be
			const findings = scan([
				{
					name: 'Skrzypczak',
					location: 'Nord (59)',
					citations: [cite('https://pj.example/departement/nord-59')],
				},
				{
					name: 'Dupont',
					location: 'Lille',
					citations: [cite('https://pj.example/departement/nord-59')],
				},
			])

			// WHEN checked — THEN neither is marked. Sharing a page is only half of it:
			// these rows came away with something, so the page was not a bare list
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, undefined])
			expect(result.marked).toBe(0)
		})

		it('should treat a blank site or place as not having one', () => {
			// GIVEN the fields present but empty, which is not the same as filled
			const findings = scan([
				{
					name: 'Acme',
					website: '   ',
					location: '',
					citations: [cite('https://pj.example/list')],
				},
				{ name: 'Beta', citations: [cite('https://pj.example/list')] },
			])

			// WHEN checked — THEN the blanks count as absent and the row is marked
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
			])
		})
	})

	describe('when the run already said something about the company', () => {
		it('should leave its own words in place', () => {
			// GIVEN a row the run itself marked, in its own words
			const findings = scan([
				{
					name: 'DAMAD',
					unconfirmed_reason: 'no trace in any register',
					citations: [cite('https://pj.example/list')],
				},
				{ name: 'Ariane', citations: [cite('https://pj.example/list')] },
			])

			// WHEN checked
			// THEN the run's own reason stands and only the silent row is marked —
			// replacing "no trace in any register" with this would say less
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined, NAME_ONLY_EVIDENCE])
			expect(
				(result.findings as { prospects: Array<Record<string, unknown>> })
					.prospects[0]?.['unconfirmed_reason'],
			).toBe('no trace in any register')
		})

		it('should not treat a blank reason as the run having spoken', () => {
			// GIVEN a reason present but empty, which says nothing
			const findings = scan([
				{
					name: 'DAMAD',
					unconfirmed_reason: '  ',
					citations: [cite('https://pj.example/list')],
				},
				{ name: 'Ariane', citations: [cite('https://pj.example/list')] },
			])

			// WHEN checked — THEN it is marked like any other silent row
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
			])
		})
	})

	describe('when a field says nothing rather than being absent', () => {
		it('should read a null site or place as not having one', () => {
			// GIVEN the fields written as null, which is a model saying it has none
			const findings = scan([
				{
					name: 'DAMAD',
					website: null,
					location: null,
					citations: [cite('https://pj.example/list')],
				},
				{ name: 'Ariane', citations: [cite('https://pj.example/list')] },
			])

			// WHEN checked — THEN null counts as absent, so the row is marked. Reading
			// it as a site would let the very rows this looks for slip past
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
			])
		})
	})

	describe('when there is no list to read', () => {
		it('should hand back what it was given for a shape that is not a scan', () => {
			// GIVEN no list field, which is every run that answers about one company
			const findings = scan([{ name: 'DAMAD' }])

			// WHEN checked with no field named — THEN nothing is touched
			const result = markNameOnlyRows(findings, undefined)
			expect(result.findings).toBe(findings)
			expect(result.marked).toBe(0)
		})

		it('should hand back findings whose list is missing or the wrong shape', () => {
			// GIVEN a scan whose list never arrived, and one where it is not a list
			// WHEN checked — THEN both come back untouched rather than throwing
			expect(markNameOnlyRows({}, 'prospects').marked).toBe(0)
			expect(markNameOnlyRows({ prospects: 'none' }, 'prospects').marked).toBe(
				0,
			)
			expect(markNameOnlyRows(null, 'prospects').marked).toBe(0)
		})

		it('should hand back the same findings when nothing is marked', () => {
			// GIVEN a list where every row has somewhere to go
			const findings = scan([{ name: 'Otis', website: 'https://otis.com' }])

			// WHEN checked — THEN the original object comes back, so a run that changed
			// nothing does not rewrite its own findings
			const result = markNameOnlyRows(findings, 'prospects')
			expect(result.findings).toBe(findings)
		})

		it('should step over a row that is not an object', () => {
			// GIVEN a list holding something that is not a row, beside two that share
			// a page
			const findings = scan([
				null as unknown as Record<string, unknown>,
				{ name: 'Ariane', citations: [cite('https://pj.example/list')] },
				{ name: 'DAMAD', citations: [cite('https://pj.example/list')] },
			])

			// WHEN checked — THEN the stray entry survives untouched and the real rows
			// are judged as if it were not there
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([
				undefined,
				NAME_ONLY_EVIDENCE,
				NAME_ONLY_EVIDENCE,
			])
		})

		it('should leave a lone row citing one page alone', () => {
			// GIVEN a single row citing a single page, which is all there is to go on
			const findings = scan([
				{ name: 'Ariane', citations: [cite('https://pj.example/list')] },
			])

			// WHEN checked
			// THEN it is not marked. A page cited once is a page about that company as
			// far as anything here can tell — it takes a second row off the same page
			// to show it was a list, and being wrong the other way would put doubt on
			// a company the run did look into
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([undefined])
		})
	})

	describe('when a citation is malformed', () => {
		it('should ignore one that names no page', () => {
			// GIVEN citations with a missing, blank, and non-string page
			const findings = scan([
				{
					name: 'DAMAD',
					citations: [
						{ quote: 'named' },
						{ source_id: '  ' },
						{ source_id: 7 },
					],
				},
			])

			// WHEN checked
			// THEN the row counts as citing nothing, which is the case it belongs in —
			// a citation pointing nowhere is not a page the run read
			const result = markNameOnlyRows(findings, 'prospects')
			expect(marksOf(result.findings)).toEqual([NAME_ONLY_EVIDENCE])
		})
	})
})
