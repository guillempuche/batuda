import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
	dropNonCompanies,
	type OrganisationKindGuardJudge,
	type OrganisationKindType,
	organisationKindGuardPrompt,
} from './organisation-kind-guard'

// A judge that rules by name, so a test says what it means and never depends on
// the order rows happen to be read in.
const rules =
	(
		byName: Record<
			string,
			OrganisationKindType | { kind: OrganisationKindType; reason: string }
		>,
	): OrganisationKindGuardJudge =>
	rows =>
		Effect.succeed({
			verdicts: rows.flatMap(row => {
				const ruling = byName[row.name]
				if (ruling === undefined) return []
				return typeof ruling === 'string'
					? [{ id: row.id, kind: ruling }]
					: [{ id: row.id, kind: ruling.kind, reason: ruling.reason }]
			}),
		})

const silent: OrganisationKindGuardJudge = () =>
	Effect.succeed({ verdicts: [] })

const namesIn = (findings: unknown): ReadonlyArray<string> =>
	(findings as { prospects: ReadonlyArray<{ name: string }> }).prospects.map(
		row => row.name,
	)

describe('dropNonCompanies', () => {
	describe('when the judge places a row', () => {
		it('should drop the row it rules is an organisation of another kind', async () => {
			// GIVEN a list holding an installer and the federation that represents it
			const findings = {
				prospects: [
					{ name: 'Instalaciones Perez', why_relevant: 'Installs' },
					{ name: 'FENIE', why_relevant: 'Federación de instaladores' },
				],
			}

			// WHEN the judge calls the federation another kind of organisation
			const result = await Effect.runPromise(
				dropNonCompanies(
					findings,
					'prospects',
					rules({ 'Instalaciones Perez': 'company', FENIE: 'other' }),
				),
			)

			// THEN only the federation goes, and the run is told why
			expect(namesIn(result.findings)).toEqual(['Instalaciones Perez'])
			expect(result.dropped).toEqual([
				{ name: 'FENIE', reason: 'not a company of this trade' },
			])
			expect(result.asked).toBe(2)
		})

		it('should drop a marketplace and a firm selling to the trade, which no word announces', async () => {
			// GIVEN the two kinds a word list could never reach
			const findings = {
				prospects: [
					{ name: 'Instalaciones Perez', why_relevant: 'Installs' },
					{
						name: 'Starofservice',
						why_relevant:
							"Plateforme listant des prestataires d'installation électrique",
					},
					{
						name: 'GeoTapp',
						why_relevant: 'Software de gestión para empresas instaladoras',
					},
				],
			}

			// WHEN the judge reads what each one says it is
			const result = await Effect.runPromise(
				dropNonCompanies(
					findings,
					'prospects',
					rules({
						'Instalaciones Perez': 'company',
						Starofservice: { kind: 'other', reason: 'lists installers' },
						GeoTapp: { kind: 'other', reason: 'sells software to installers' },
					}),
				),
			)

			// THEN both go, each carrying the judge's own reason
			expect(namesIn(result.findings)).toEqual(['Instalaciones Perez'])
			expect(result.dropped).toEqual([
				{ name: 'Starofservice', reason: 'lists installers' },
				{ name: 'GeoTapp', reason: 'sells software to installers' },
			])
		})

		it('should keep a row it is unsure about', async () => {
			// GIVEN a row too thin to place
			const findings = { prospects: [{ name: 'ABC 2000 S.L.' }] }

			// WHEN the judge says so rather than guessing
			const result = await Effect.runPromise(
				dropNonCompanies(
					findings,
					'prospects',
					rules({ 'ABC 2000 S.L.': 'unsure' }),
				),
			)

			// THEN it stays — a judge that cannot tell must not empty a list
			expect(namesIn(result.findings)).toEqual(['ABC 2000 S.L.'])
			expect(result.dropped).toEqual([])
			expect(result.asked).toBe(1)
		})
	})

	describe('when the judge says nothing about a row', () => {
		it('should keep every row when the judge answers with nothing at all', async () => {
			// GIVEN a judge that failed, so the wired call handed back no verdicts
			const findings = {
				prospects: [{ name: 'FENIE' }, { name: 'Instalaciones Perez' }],
			}

			// WHEN the list is checked against it
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', silent),
			)

			// THEN nothing is dropped, though the rows were put to it
			expect(namesIn(result.findings)).toEqual(['FENIE', 'Instalaciones Perez'])
			expect(result.dropped).toEqual([])
			expect(result.asked).toBe(2)
		})

		it('should ignore a verdict carrying an id nothing was asked under', async () => {
			// GIVEN a judge naming a row that was never sent
			const findings = { prospects: [{ name: 'Instalaciones Perez' }] }
			const strayId: OrganisationKindGuardJudge = () =>
				Effect.succeed({ verdicts: [{ id: '99', kind: 'other' }] })

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', strayId),
			)

			// THEN no row is dropped on it
			expect(namesIn(result.findings)).toEqual(['Instalaciones Perez'])
			expect(result.dropped).toEqual([])
		})
	})

	describe('what the judge is shown, and when it is asked at all', () => {
		it('should show a row its name and every way it describes itself', async () => {
			// GIVEN a row describing itself in three fields
			const findings = {
				prospects: [
					{
						name: 'FENIE',
						why_relevant: 'Federación de instaladores',
						description: 'Representa a las empresas',
						industry: 'Asociación sectorial',
					},
				],
			}
			const judge = vi.fn<OrganisationKindGuardJudge>(() =>
				Effect.succeed({ verdicts: [] }),
			)

			// WHEN the list is checked
			await Effect.runPromise(dropNonCompanies(findings, 'prospects', judge))

			// THEN all three reach the judge, joined into what the row says it is
			expect(judge).toHaveBeenCalledWith([
				{
					id: 'r0',
					name: 'FENIE',
					describedAs:
						'Federación de instaladores · Representa a las empresas · Asociación sectorial',
				},
			])
		})

		it('should show a row that describes itself nowhere as a bare name', async () => {
			// GIVEN a row that is only a name
			const findings = { prospects: [{ name: 'Instalaciones Perez' }] }
			const judge = vi.fn<OrganisationKindGuardJudge>(() =>
				Effect.succeed({ verdicts: [] }),
			)

			// WHEN the list is checked
			await Effect.runPromise(dropNonCompanies(findings, 'prospects', judge))

			// THEN it is still put to the judge, with nothing invented around it
			expect(judge).toHaveBeenCalledWith([
				{ id: 'r0', name: 'Instalaciones Perez', describedAs: '' },
			])
		})

		it('should keep a row with neither a name nor a description', async () => {
			// GIVEN a row that says nothing whatsoever
			const findings = { prospects: [{ website: 'https://acme.es' }] }

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', silent),
			)

			// THEN it survives — there is nothing to condemn it on
			expect(
				(result.findings as { prospects: ReadonlyArray<unknown> }).prospects,
			).toHaveLength(1)
		})

		it('should ask nothing of the judge when the run has no list', async () => {
			// GIVEN a run about one named company, which has no list to check
			const findings = { enrichment: { industry: 'retail' } }
			const judge = vi.fn<OrganisationKindGuardJudge>(() =>
				Effect.succeed({ verdicts: [] }),
			)

			// WHEN it passes through
			const result = await Effect.runPromise(
				dropNonCompanies(findings, undefined, judge),
			)

			// THEN nothing is asked and nothing is paid for
			expect(judge).not.toHaveBeenCalled()
			expect(result.findings).toBe(findings)
			expect(result.asked).toBe(0)
		})

		it('should ask nothing of the judge when the list came back empty', async () => {
			// GIVEN a scan that found nobody
			const findings = { prospects: [] }
			const judge = vi.fn<OrganisationKindGuardJudge>(() =>
				Effect.succeed({ verdicts: [] }),
			)

			// WHEN it is checked
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', judge),
			)

			// THEN there is nothing to weigh, so nothing is spent
			expect(judge).not.toHaveBeenCalled()
			expect(result.asked).toBe(0)
		})
	})

	describe('when the judge answers with something that is not a ruling', () => {
		it('should keep every row when the answer carries no verdict list at all', async () => {
			// GIVEN a judge that resolves with a shape nobody expected — a stub wired
			//   to the wrong prompt, or a vendor answering the previous question
			const findings = {
				prospects: [
					{ name: 'FENIE', why_relevant: 'Federación' },
					{ name: 'Perez', why_relevant: 'Installs' },
				],
			}
			const confused = (() =>
				Effect.succeed({
					prospects: [],
				})) as unknown as OrganisationKindGuardJudge

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', confused),
			)

			// THEN the list survives whole, and the two counts say the check did not
			//   run — reaching into that answer instead is how a judge falling over
			//   stops being a kept list and becomes a failed run
			expect(namesIn(result.findings)).toEqual(['FENIE', 'Perez'])
			expect(result.asked).toBe(2)
			expect(result.ruled).toBe(0)
		})

		it('should report every row ruled on when the judge does answer', async () => {
			// GIVEN a judge that places both rows
			const findings = {
				prospects: [
					{ name: 'FENIE', why_relevant: 'Federación' },
					{ name: 'Perez', why_relevant: 'Installs' },
				],
			}

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies(
					findings,
					'prospects',
					rules({ FENIE: 'other', Perez: 'company' }),
				),
			)

			// THEN asked and ruled agree, which is what tells a quiet clean list from
			//   a check that never ran
			expect(result.asked).toBe(2)
			expect(result.ruled).toBe(2)
		})
	})

	describe('when the same run checks a list more than once', () => {
		it('should ask only about rows it has no answer for yet', async () => {
			// GIVEN a first pass over two rows
			const first = {
				prospects: [
					{ name: 'FENIE', why_relevant: 'Federación' },
					{ name: 'Perez', why_relevant: 'Installs' },
				],
			}
			const judge = vi.fn<OrganisationKindGuardJudge>(rows =>
				Effect.succeed({
					verdicts: rows.map(row => ({
						id: row.id,
						kind:
							row.name === 'FENIE' ? ('other' as const) : ('company' as const),
					})),
				}),
			)
			const pass1 = await Effect.runPromise(
				dropNonCompanies(first, 'prospects', judge),
			)

			// WHEN a gap round adds one row and the run checks again, carrying what
			//   the first pass learned
			const second = {
				prospects: [
					{ name: 'FENIE', why_relevant: 'Federación' },
					{ name: 'Perez', why_relevant: 'Installs' },
					{ name: 'Habitissimo', why_relevant: 'Marketplace' },
				],
			}
			const pass2 = await Effect.runPromise(
				dropNonCompanies(second, 'prospects', judge, pass1.learned),
			)

			// THEN only the new row is paid for, while the row the first pass placed
			//   is still dropped on the answer it already has
			expect(judge).toHaveBeenCalledTimes(2)
			expect(judge.mock.calls[1]?.[0]?.map(row => row.name)).toEqual([
				'Habitissimo',
			])
			expect(namesIn(pass2.findings)).toEqual(['Perez', 'Habitissimo'])
			expect(pass2.asked).toBe(3)
			expect(pass2.ruled).toBe(3)
		})
	})

	describe('when a later pass rewrites how a row describes itself', () => {
		it('should keep dropping a row it already placed, however the words change', async () => {
			// GIVEN a pass that drops an information site for what it says it is
			const first = {
				prospects: [
					{
						name: 'Solartech France',
						why_relevant:
							'Provides technical guides and legislative information for PV installations',
					},
				],
			}
			const judge = vi.fn<OrganisationKindGuardJudge>(rows =>
				Effect.succeed({
					verdicts: rows.map(row => ({
						id: row.id,
						kind: (row.describedAs.includes('guides')
							? 'other'
							: 'company') as OrganisationKindType,
					})),
				}),
			)
			const pass1 = await Effect.runPromise(
				dropNonCompanies(first, 'prospects', judge),
			)
			expect(namesIn(pass1.findings)).toEqual([])

			// WHEN a later pass writes the same organisation up as a company —
			//   measured on a live run, this is what the wording actually became
			const second = {
				prospects: [
					{
						name: 'Solartech France',
						why_relevant:
							'Provides French legislation and technical guides for photovoltaic installations – a PV-installation company or specialist.',
					},
				],
			}
			const pass2 = await Effect.runPromise(
				dropNonCompanies(second, 'prospects', judge, pass1.learned),
			)

			// THEN the answer the run already reached stands, and nothing is bought
			//   to reach it again. Remembered under the wording instead, this row
			//   shipped as an installer.
			expect(namesIn(pass2.findings)).toEqual([])
			expect(judge).toHaveBeenCalledTimes(1)
			expect(pass2.dropped).toHaveLength(1)
		})

		it('should ask again about a row it kept, so a clearer wording can still drop it', async () => {
			// GIVEN a pass that could not place a thin row and kept it
			const first = { prospects: [{ name: 'Colmena Solar' }] }
			const judge = vi.fn<OrganisationKindGuardJudge>(rows =>
				Effect.succeed({
					verdicts: rows.map(row => ({
						id: row.id,
						kind: (row.describedAs === ''
							? 'unsure'
							: 'other') as OrganisationKindType,
						...(row.describedAs === ''
							? {}
							: { reason: 'platform selling panels' }),
					})),
				}),
			)
			const pass1 = await Effect.runPromise(
				dropNonCompanies(first, 'prospects', judge),
			)
			expect(namesIn(pass1.findings)).toEqual(['Colmena Solar'])

			// WHEN a later pass says what it is
			const second = {
				prospects: [
					{
						name: 'Colmena Solar',
						why_relevant: 'Plataforma de venta de placas',
					},
				],
			}
			const pass2 = await Effect.runPromise(
				dropNonCompanies(second, 'prospects', judge, pass1.learned),
			)

			// THEN it is asked again and goes. A memory that held every answer as
			//   firmly as a drop would keep a marketplace for the whole run on the
			//   strength of one pass that could not tell.
			expect(judge).toHaveBeenCalledTimes(2)
			expect(namesIn(pass2.findings)).toEqual([])
			expect(pass2.dropped[0]?.reason).toBe('platform selling panels')
		})

		it('should read two spellings of one name as the same organisation', async () => {
			// GIVEN a pass that drops a supplier written with its legal form
			const first = {
				prospects: [{ name: 'URANOGAS S.L.', why_relevant: 'Sells equipment' }],
			}
			const judge = vi.fn<OrganisationKindGuardJudge>(rows =>
				Effect.succeed({
					verdicts: rows.map(row => ({
						id: row.id,
						kind: 'other' as OrganisationKindType,
					})),
				}),
			)
			const pass1 = await Effect.runPromise(
				dropNonCompanies(first, 'prospects', judge),
			)

			// WHEN a later pass writes the name another way
			const second = {
				prospects: [
					{ name: 'Uranogas SL', why_relevant: 'Listado entre empresas' },
				],
			}
			const pass2 = await Effect.runPromise(
				dropNonCompanies(second, 'prospects', judge, pass1.learned),
			)

			// THEN it is still the same organisation, so the answer still stands —
			//   the fold is the one the de-duplication link uses, so the two checks
			//   cannot disagree about whether two rows are one company
			expect(judge).toHaveBeenCalledTimes(1)
			expect(namesIn(pass2.findings)).toEqual([])
		})
	})

	describe('when the list is longer than one question', () => {
		it('should ask in batches and act on every batch', async () => {
			// GIVEN a list well past what one question carries
			const prospects = Array.from({ length: 60 }, (_, at) => ({
				name: `Row ${at}`,
				why_relevant: at % 10 === 0 ? 'Directorio' : 'Installs',
			}))
			const judge = vi.fn<OrganisationKindGuardJudge>(rows =>
				Effect.succeed({
					verdicts: rows.map(row => ({
						id: row.id,
						kind: row.describedAs.startsWith('Directorio')
							? ('other' as const)
							: ('company' as const),
					})),
				}),
			)

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies({ prospects }, 'prospects', judge),
			)

			// THEN it went in several questions, no row was asked twice, and the
			//   answers from every batch were applied — a whole market list in one
			//   prompt is how this check comes to be skipped on the longest lists
			expect(judge.mock.calls.length).toBeGreaterThan(1)
			const asked = judge.mock.calls.flatMap(call =>
				(call[0] ?? []).map(row => row.id),
			)
			expect(new Set(asked).size).toBe(60)
			expect(result.dropped).toHaveLength(6)
			expect(result.ruled).toBe(60)
		})
	})

	describe('when the answer is shaped some other way', () => {
		it('should read a competitor list the same way as a prospect list', async () => {
			// GIVEN a competitor scan, whose rows describe themselves in `description`
			const findings = {
				competitors: [
					{ name: 'AENOR', description: 'Standards body' },
					{ name: 'Instalaciones Perez', description: 'Installs' },
				],
			}

			// WHEN the list is checked under its own field name
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'competitors', rules({ AENOR: 'other' })),
			)

			// THEN the same rule applies to it
			expect(
				(
					result.findings as { competitors: ReadonlyArray<{ name: string }> }
				).competitors.map(row => row.name),
			).toEqual(['Instalaciones Perez'])
		})

		it('should filter a list that sits inside another array', async () => {
			// GIVEN the list nested a level down, which the walk has to reach
			const findings = {
				rounds: [{ prospects: [{ name: 'FENIE' }, { name: 'Perez' }] }],
			}

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', rules({ FENIE: 'other' })),
			)

			// THEN the nested row is dropped, tied to its verdict by identity
			expect(
				(
					result.findings as {
						rounds: ReadonlyArray<{
							prospects: ReadonlyArray<{ name: string }>
						}>
					}
				).rounds[0]?.prospects.map(row => row.name),
			).toEqual(['Perez'])
		})

		it('should leave a list entry that is not an object alone', async () => {
			// GIVEN a malformed list holding a bare string
			const findings = { prospects: ['FENIE', { name: 'Perez' }] }

			// WHEN the list is checked
			const result = await Effect.runPromise(
				dropNonCompanies(findings, 'prospects', rules({ Perez: 'company' })),
			)

			// THEN the string is neither judged nor dropped
			expect(
				(result.findings as { prospects: ReadonlyArray<unknown> }).prospects,
			).toEqual(['FENIE', { name: 'Perez' }])
		})

		it('should leave findings that are null or a bare value untouched', async () => {
			// GIVEN findings that are not an object at all
			// WHEN each is checked
			const nothing = await Effect.runPromise(
				dropNonCompanies(null, 'prospects', silent),
			)
			const bare = await Effect.runPromise(
				dropNonCompanies('nothing here', 'prospects', silent),
			)

			// THEN both come back as they went in
			expect(nothing.findings).toBeNull()
			expect(bare.findings).toBe('nothing here')
		})
	})
})

describe('organisationKindGuardPrompt', () => {
	describe('when rows are put to the model', () => {
		it('should name each row under the id its verdict must carry', () => {
			// GIVEN two rows, one of them describing itself
			const prompt = organisationKindGuardPrompt([
				{ id: 'r0', name: 'FENIE', describedAs: 'Federación de instaladores' },
				{ id: 'r1', name: 'Perez', describedAs: '' },
			])

			// WHEN the prompt is read
			// THEN each row appears once, under its id, its own words written as
			//   JSON strings, and a row with nothing to add carries no empty quotes
			expect(prompt).toContain('[r0] "FENIE" "Federación de instaladores"')
			expect(prompt).toContain('[r1] "Perez"')
			expect(prompt).not.toContain('"Perez" ""')
		})

		// The rules that keep a real company on the list. The check has no reading of
		// its own any more, so the prompt IS the behaviour — dropping one of these
		// lines is a silent change to what a scan returns, and only a test that
		// reads the line can say so.
		it('should tell the model that belonging to a body is not being one', () => {
			// GIVEN the question as it is asked
			const prompt = organisationKindGuardPrompt([
				{ id: 'r0', name: 'Perez', describedAs: '' },
			])

			// WHEN the rules under the three answers are read
			// THEN a company that names its federation is still a company. Left out,
			//   the installers who say which body they belong to are exactly the ones
			//   dropped, and they are most of a good list.
			expect(prompt).toMatch(/Belonging to an association does not make/i)
		})

		it('should tell the model that size and selling to businesses are not marks of another kind', () => {
			// GIVEN the question as it is asked
			const prompt = organisationKindGuardPrompt([
				{ id: 'r0', name: 'Perez', describedAs: '' },
			])

			// WHEN the same rules are read
			// THEN a large installer working for other businesses stays a company —
			//   the nearest thing to a supplier-to-the-trade that is not one
			expect(prompt).toMatch(/not "other" merely for being large/i)
		})

		it('should tell the model to say it is unsure rather than guess', () => {
			// GIVEN the question as it is asked
			const prompt = organisationKindGuardPrompt([
				{ id: 'r0', name: 'Perez', describedAs: '' },
			])

			// WHEN the instruction above the rows is read
			// THEN a thin row is answered "unsure", which keeps it. Without this the
			//   cheapest way to answer a row that says nothing is to guess.
			expect(prompt).toMatch(
				/answer "unsure" wherever you would have to guess/i,
			)
		})

		it('should offer all three answers, so being unsure is sayable', () => {
			// GIVEN any row
			const prompt = organisationKindGuardPrompt([
				{ id: 'r0', name: 'Perez', describedAs: '' },
			])

			// WHEN the prompt is read
			// THEN a model that cannot place a row has an answer other than guessing
			expect(prompt).toContain('"company"')
			expect(prompt).toContain('"other"')
			expect(prompt).toContain('"unsure"')
		})
	})
})
