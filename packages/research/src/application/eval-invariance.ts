/**
 * Compares the same company researched under two opposite framings (for example
 * "find small family firms" vs "find large enterprises"), so the eval can prove
 * the framing steered only WHERE the run searched — never what counted as
 * evidence. If a firmographic, the entity verdict, or the contact list changes
 * with the framing, the instruction split has leaked into acceptance.
 *
 * Pure comparison only; the CLI runs the two billable runs and adapts them into
 * `FramingOutcome`s.
 */

import type { ScorableField } from './eval-scoring'
import { foldDiacritics, normalizeText, SCORABLE_FIELDS } from './eval-scoring'

export interface FramingOutcome {
	/** Scorable field values the run reported (null/undefined = not filled). */
	readonly fields: Partial<Record<ScorableField, string | null>>
	/** The run's final entity verdict, from its findings. */
	readonly entityMatch: string | null
	/** Named contacts the run returned. */
	readonly contacts: ReadonlyArray<{ readonly name: string }>
}

export interface FramingComparison {
	/** Scorable fields whose reported values differ between the two framings. */
	readonly divergentFields: ReadonlyArray<ScorableField>
	/** True when the two runs reached different entity verdicts. */
	readonly entityMatchDiverged: boolean
	/** Contact names only the first framing returned. */
	readonly contactsOnlyInA: ReadonlyArray<string>
	/** Contact names only the second framing returned. */
	readonly contactsOnlyInB: ReadonlyArray<string>
	/** The invariant: same facts, same verdict, same people under both framings. */
	readonly invariant: boolean
}

// Values compare case-, whitespace- and accent-insensitively (reusing the eval's
// own normalizers), so "José García" vs "Jose Garcia" is not read as a framing
// leak; an empty string counts as unfilled, so "not filled" under one framing and
// "" under the other agree.
const normalize = (value: string | null | undefined): string =>
	foldDiacritics(normalizeText(value ?? ''))

const nameSet = (
	contacts: ReadonlyArray<{ readonly name: string }>,
): Set<string> =>
	new Set(
		contacts
			.map(contact => normalize(contact.name))
			.filter(name => name !== ''),
	)

export const compareFramings = (
	a: FramingOutcome,
	b: FramingOutcome,
): FramingComparison => {
	const divergentFields = SCORABLE_FIELDS.filter(
		field => normalize(a.fields[field]) !== normalize(b.fields[field]),
	)
	const entityMatchDiverged =
		normalize(a.entityMatch) !== normalize(b.entityMatch)
	const namesA = nameSet(a.contacts)
	const namesB = nameSet(b.contacts)
	const contactsOnlyInA = [...namesA].filter(name => !namesB.has(name))
	const contactsOnlyInB = [...namesB].filter(name => !namesA.has(name))
	return {
		divergentFields,
		entityMatchDiverged,
		contactsOnlyInA,
		contactsOnlyInB,
		invariant:
			divergentFields.length === 0 &&
			!entityMatchDiverged &&
			contactsOnlyInA.length === 0 &&
			contactsOnlyInB.length === 0,
	}
}
