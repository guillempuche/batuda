/**
 * Cutting a piece of text down to a length, without cutting a character in half.
 *
 * JavaScript measures a string in UTF-16 units rather than in characters, and
 * anything outside the everyday range — an emoji, and the rarer Chinese and
 * Japanese characters — takes two of them. `slice` counts those units, so a cut
 * landing between the two halves of one character keeps half a character: a piece
 * of a letter that is not a letter, and not text at all.
 *
 * That half-character is not merely ugly. Written out as JSON it becomes the six
 * plain characters `\ud83d`, which travel to Postgres perfectly well and are then
 * refused by its JSON reader — `invalid input syntax for type json` — so the whole
 * write fails. A run that scraped a page with an emoji at the wrong offset could
 * not file what it had found. Reproduced against a real database; the same text in
 * an ordinary text column is accepted, with the half character replaced by `�`.
 *
 * So every cut of text nobody controls goes through here. The text that arrives is
 * whatever a web page, an email or a model produced, and none of them owe us
 * characters that survive being cut in the middle.
 */

// Whole characters rather than the units they are stored in. Anything above the
// everyday range takes two units, and spreading the string hands back the
// characters themselves — which is what a length should have been counting all
// along.
const charactersOf = (value: string): ReadonlyArray<string> => [...value]

/**
 * The first `maxCharacters` characters of a value, counted as a reader would count
 * them. A value already that short comes back untouched, so the common case
 * allocates nothing.
 *
 * Counting characters rather than storage units also means the result is at most
 * `maxCharacters` characters wherever the text comes from, instead of shrinking to
 * half that for a language whose characters happen to take two units each.
 */
export const clipText = (value: string, maxCharacters: number): string => {
	if (maxCharacters <= 0) return ''
	// `length` is the storage count, so it is never smaller than the character
	// count — a value under the limit by that measure is under it by any measure,
	// and there is nothing to cut.
	if (value.length <= maxCharacters) return value
	const characters = charactersOf(value)
	return characters.length <= maxCharacters
		? value
		: characters.slice(0, maxCharacters).join('')
}
