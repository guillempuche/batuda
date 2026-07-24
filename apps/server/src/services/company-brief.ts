/**
 * Decides when an edit to a company's notes counts as a person taking ownership
 * of them.
 *
 * A company keeps one running set of account notes that both people and research
 * write. Research is allowed to replace notes nobody has touched, but once a
 * person has written in them it may only add underneath — otherwise a run would
 * quietly wipe what somebody wrote. The whole of that decision rests on one
 * marker on the row, so the rule for setting it lives here, in one place, rather
 * than being restated by each way in which a company can be edited.
 *
 * An agent may write the notes, but never sets the marker: if it did, its own
 * text would masquerade as a person's and shut later research out of the notes
 * it is supposed to keep up to date.
 */

import { DateTime } from 'effect'

/** Who is making the edit, as each transport already knows them. */
export interface BriefActor {
	readonly userId: string
	readonly isAgent: boolean
}

/**
 * Add the ownership marker to a company update when a person is editing the
 * notes, and otherwise hand the update back untouched.
 */
export const withBriefOwnership = <Fields extends Record<string, unknown>>(
	fields: Fields,
	actor: BriefActor,
): Fields | (Fields & { briefUpdatedBy: string; briefUpdatedAt: Date }) =>
	fields['accountBrief'] !== undefined && !actor.isAgent
		? {
				...fields,
				briefUpdatedBy: actor.userId,
				briefUpdatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
			}
		: fields
