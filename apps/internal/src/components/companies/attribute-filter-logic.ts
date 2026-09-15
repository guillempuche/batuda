import {
	type AttributeKind,
	type AttributeOp,
	coerceAttributeValue,
	OPS_FOR_KIND,
} from '@batuda/domain'

import { canonicalWords } from '#/lib/companies-search-params'

/**
 * The rules behind the attribute filter, away from the control that draws it:
 * which comparisons a kind offers, what a typed value becomes in the address,
 * and what an address gives back to the control.
 *
 * The address is the filter — the control only edits it — so both directions
 * are written here and both are tested, rather than one being read off the
 * other at a glance.
 */

/** The comparisons a kind offers, in the order they are shown. */
export function opsFor(kind: AttributeKind): ReadonlyArray<AttributeOp> {
	return OPS_FOR_KIND[kind]
}

/**
 * The comparison to work with: the one asked for where the kind offers it, and
 * otherwise the first the kind declares, which is "is" for every kind — the one
 * a reader means by default.
 *
 * A link can name a comparison the attribute cannot answer — "at least" for a
 * yes/no, or one left over from when the key was a number — and a control
 * pointing at an option it does not hold has no way back.
 */
export function clampOp(
	kind: AttributeKind,
	op: AttributeOp | null,
): AttributeOp {
	const offered = opsFor(kind)
	return op !== null && offered.includes(op) ? op : (offered[0] ?? 'eq')
}

/**
 * One value in the two shapes a control needs: the text a box holds, and the
 * words a "one of" list has ticked. Only one of the two is ever read — which
 * one depends on the control the kind gets.
 */
type DraftValue = {
	readonly text: string
	readonly values: ReadonlyArray<string>
}

/**
 * What the reader's value becomes in the address, or null when it says nothing
 * the list can be narrowed by — an empty box, a number that is not one, a date
 * that is not a day, a word longer than a value may be.
 *
 * A choice word is folded to the declaration's own spelling, whatever case or
 * accents were used. A single one the declaration does not list says nothing: the
 * server answers an unknown word with a refusal, so the page would land on an
 * error over a word nobody can see any more.
 */
export function valueParam(
	kind: AttributeKind,
	op: AttributeOp,
	input: string | ReadonlyArray<string>,
	enumValues: ReadonlyArray<string>,
): string | null {
	if (op === 'in') {
		const asked: Array<string> = []
		for (const word of canonicalWords(input)) {
			if (kind === 'enum') {
				// A word the declaration no longer lists is left out rather than taking
				// the whole list with it: the words beside it still narrow the list, and
				// the server would refuse the filter over the one word.
				const declared = coerceAttributeValue('enum', word, enumValues)
				if (typeof declared === 'string') asked.push(declared)
				continue
			}
			// Held to what a stored value may be, so a word too long to store is
			// refused here rather than by the server.
			const text = coerceAttributeValue('text', word, null)
			if (typeof text !== 'string') return null
			asked.push(text)
		}
		// Folded again: two spellings of one word come back as one, and the
		// declaration's own spelling may not sort where the typed one did.
		const words = canonicalWords(asked)
		return words.length === 0 ? null : words.join(',')
	}
	const text = typeof input === 'string' ? input : (input[0] ?? '')
	if (kind === 'enum') {
		const declared = coerceAttributeValue('enum', text, enumValues)
		return typeof declared === 'string' ? declared : null
	}
	// Read as its kind and written back out, so "007" filters as 7 and " yes " as
	// true — the same forgiveness the server shows a stored value. "Contains"
	// searches inside a stored value, so it is held to the same length as one.
	const value = coerceAttributeValue(
		op === 'contains' ? 'text' : kind,
		text,
		null,
	)
	return value === null ? null : String(value)
}

/**
 * The address value as the control holds it: the list split back into words for
 * a "one of", and the text for everything else.
 */
export function parseValueParam(
	kind: AttributeKind,
	op: AttributeOp,
	param: string,
	enumValues: ReadonlyArray<string>,
): DraftValue {
	if (op === 'in') {
		// Folded before the duplicates are dropped, so one word spelled two ways in
		// an old link is ticked once rather than offered twice.
		const values = canonicalWords(
			canonicalWords(param).map(word => foldWord(kind, word, enumValues)),
		)
		return { text: values.join(', '), values }
	}
	return { text: foldWord(kind, param.trim(), enumValues), values: [] }
}

/**
 * One value as the declaration spells it, or as the address wrote it when it
 * cannot be read that way.
 *
 * A yes/no comes back as `true` or `false` whatever word a link used, and a
 * choice in the spelling the declaration lists. One that fits neither — a word
 * nobody declares any more, an answer that is neither yes nor no — is kept as it
 * stands, so the control can show it and the reader can take it off the filter.
 */
function foldWord(
	kind: AttributeKind,
	word: string,
	enumValues: ReadonlyArray<string>,
): string {
	if (kind !== 'enum' && kind !== 'boolean') return word
	const folded = coerceAttributeValue(kind, word, enumValues)
	return folded === null ? word : String(folded)
}
