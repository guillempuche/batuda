/**
 * Asks a model what kind of organisation each row of a market list is, so the eval
 * can judge a list without sharing the blind spot of the check it is judging.
 *
 * A search for a trade runs straight through the pages where that trade's companies
 * are named — an association's member list, a business directory, a quotes
 * marketplace — and brings whoever published the page back looking like a company.
 * The golden file catches only the ones somebody thought to list, which in practice
 * means the trade bodies; the other kinds are not names anybody can enumerate in
 * advance, and a marketplace listing installers reads exactly like an installer.
 *
 * A model reads every language a market answers in and reads a sentence rather than
 * a word, so asking is both more accurate and less to maintain. What matters for a
 * measurement is that this asks *separately* from the check the pipeline uses: if
 * the eval decided kind the same way the pipeline does, it could never show the
 * pipeline being wrong. The two ask the same question in deliberately different
 * words, and both follow #456 §4.1 — does the organisation do the trade's work, or
 * do the ones who do it belong to it, buy from it, or get pointed at by it.
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

import { goldenKindOf } from './eval-scoring-market'

/** Which way settled what a row is. */
export type KindMethod =
	| 'golden-listed'
	| 'judged'
	| 'unjudged'
	/**
	 * The golden's list could not be held against this name at all — nothing in it
	 * is written in letters this reading has. Apart from `unjudged`, because "the
	 * model was not asked" and "the list could not be read" are different answers,
	 * and averaging the second into a clean figure is how a pass reports the
	 * precision of a market it is blind to.
	 */
	| 'name-unreadable'

/** What one row was decided to be, and by what. */
export interface OrganisationKind {
	/** False for anything the trade belongs to, buys from, or is listed by. */
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
		'  "company" — it does the work of the trade itself, for customers who want that work done: it installs, manufactures, builds or services.',
		'  "other"   — the ones who do that work are its members, its customers, or the people it lists. That covers a trade association, federation, employers\' body, guild, chamber of commerce, professional college, standards body or sector system operator; a directory, listings site or marketplace that lists them; and a supplier whose customers are the trade itself, such as a firm selling software, tools or parts to installers.',
		'  "unsure"  — the row does not say enough to tell.',
		'',
		'Judge only what the row says about itself. A company that belongs to an association is still a company. A body trading under initials is still a body.',
		'Who buys is what separates a company from a supplier: an installer sells installation work to the people who want it, while a firm selling design software to installers sells to the trade.',
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
		// Only a name the list actually named settles it here. A name this reading
		// cannot read goes to the model with the rest — the model is the one reader
		// in this chain that does read every writing system, which is what it is for.
		const listed = rows.map(
			row => goldenKindOf(row.name, notCompanies) === 'listed',
		)
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
