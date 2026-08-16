/**
 * Asks a model what kind of organisation each row of a market list is, so the eval
 * can judge a list without sharing the blind spot of the check it is judging.
 *
 * A search for a trade runs straight through the bodies that represent it — the
 * associations, federations and guilds whose pages are where the member companies
 * are named — and brings them back looking like companies. Two things decide that
 * today and both are narrow: the golden file names the bodies somebody thought to
 * list, and the shipped check that drops them reads word lists in three languages,
 * recognising four of fifteen European bodies. A body in French or German passes
 * both, so the figure that exists to catch them reports a clean list.
 *
 * A model reads every one of those languages and a body says what it is in its own
 * words on its own page, so asking is both more accurate and less to maintain. What
 * matters for a measurement is that this asks *separately* from the check the
 * pipeline uses: if the eval decided kind the same way the pipeline does, it could
 * never show the pipeline being wrong.
 *
 * Three rules keep the answer honest:
 *  - a row the golden file names is a body whatever the model says, because a person
 *    checked that one and a model has no standing to overrule them;
 *  - a model that errors or cannot tell leaves the row a company, which is what the
 *    figure assumed before any of this existed — a judge falling over must not
 *    invent a fault;
 *  - every row records which of the three decided it, because a pass where the model
 *    faltered halfway is one number computed two ways, and that has to be visible
 *    rather than averaged into silence.
 */

import { Effect, Schema } from 'effect'

import { isKnownNonCompany } from './eval-scoring-market'

/** Which of the three ways settled what a row is. */
export type KindMethod = 'golden-listed' | 'judged' | 'unjudged'

/** What one row was decided to be, and by what. */
export interface OrganisationKind {
	/** False for a trade body, federation, guild, chamber or system operator. */
	readonly isCompany: boolean
	readonly method: KindMethod
}

/**
 * The model's ruling per row: a company that does the work of the trade, or an
 * organisation of another kind that represents, regulates, supplies or lists them.
 * `unsure` is a real answer and leaves the row alone.
 */
export const OrganisationKindVerdictsSchema = Schema.Struct({
	verdicts: Schema.Array(
		Schema.Struct({
			index: Schema.Number,
			kind: Schema.Literals(['company', 'other', 'unsure']),
		}),
	),
})

export type OrganisationKindVerdicts =
	typeof OrganisationKindVerdictsSchema.Type

/** One row as the judge sees it: what it calls itself and how it describes itself. */
export interface KindCandidate {
	readonly name: string
	readonly describedAs: string
}

/**
 * The question put to the model. Deliberately not the wording the pipeline's own
 * check uses — the eval has to be able to disagree with it.
 */
export const organisationKindPrompt = (
	rows: ReadonlyArray<KindCandidate>,
): string =>
	[
		'You are reading rows returned by a search for companies in a trade.',
		'',
		'For each row, say what kind of organisation it is:',
		'  "company" — it does the work of the trade itself (it installs, manufactures, supplies, services).',
		'  "other"   — it represents, regulates, certifies, lobbies for or lists the ones that do: a trade association, federation, employers\' body, guild, chamber of commerce, professional college, standards body, or a sector system operator.',
		'  "unsure"  — the row does not say enough to tell.',
		'',
		'Judge only what the row says about itself. A company that belongs to an association is still a company. A body trading under initials is still a body.',
		'',
		'Rows:',
		...rows.map(
			(row, index) =>
				`  ${index}. ${row.name}${row.describedAs ? ` — ${row.describedAs}` : ''}`,
		),
	].join('\n')

/**
 * What the caller supplies: ask the model, hand back its rulings. Whatever it needs
 * to reach a model rides in `R`, so this file needs to know nothing about which tier
 * answers or how it is wired — which is what lets it be tested with no model at all.
 */
export type OrganisationKindJudge<R = never> = (
	rows: ReadonlyArray<KindCandidate>,
) => Effect.Effect<OrganisationKindVerdicts, unknown, R>

/**
 * Decide what each row is, in the order the rows came back.
 *
 * The golden file wins outright, so only the rows it says nothing about are put to
 * the model — which is also the cheaper half, since a listed body needs no call.
 */
export const judgeOrganisationKinds = <R = never>(
	rows: ReadonlyArray<KindCandidate>,
	notCompanies: ReadonlyArray<string>,
	judge: OrganisationKindJudge<R>,
): Effect.Effect<ReadonlyArray<OrganisationKind>, never, R> =>
	Effect.gen(function* () {
		const listed = rows.map(row => isKnownNonCompany(row.name, notCompanies))
		const toAsk = rows.filter((_, index) => !listed[index])
		if (toAsk.length === 0) {
			return listed.map(isListed => ({
				isCompany: !isListed,
				method: 'golden-listed' as const,
			}))
		}

		// A judge that falls over leaves every row it was asked about unjudged, which
		// keeps them companies — the reading this figure had before a model was
		// involved. It must never turn an outage into a list full of faults.
		const ruling = yield* judge(toAsk).pipe(
			Effect.catchCause(() => Effect.succeed({ verdicts: [] })),
		)
		const byIndex = new Map(
			ruling.verdicts.map(verdict => [verdict.index, verdict.kind]),
		)

		let asked = -1
		return rows.map((_, index) => {
			if (listed[index]) {
				return { isCompany: false, method: 'golden-listed' as const }
			}
			asked += 1
			const kind = byIndex.get(asked)
			if (kind === undefined) {
				return { isCompany: true, method: 'unjudged' as const }
			}
			// `unsure` is an answer, and its answer is "leave it alone" — the row stays
			// a company, but the model did rule on it, so it counts as judged.
			return { isCompany: kind !== 'other', method: 'judged' as const }
		})
	})
