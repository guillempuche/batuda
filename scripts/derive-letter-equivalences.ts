/**
 * Writes the table that says which plain letters a letter outside a–z stands
 * for: ß is ss, ø is o, ł is l, þ is th.
 *
 * Nothing here is typed by hand. Every answer comes from data somebody else
 * maintains for every language and that Node already ships — the Unicode
 * character database, reached through `Intl.Collator` and through the
 * upper-case mappings. A list written here would cover the languages whoever
 * wrote it happened to know, and be quietly wrong everywhere else.
 *
 * Run it with `pnpm derive-letter-equivalences`. It rewrites the generated file
 * in place; commit the result. It is generated rather than worked out while the
 * server runs so that the answers are in the diff where they can be read, and
 * so a new version of Node cannot quietly change which companies match.
 *
 * Three sources are asked in turn, because no single one knows every letter:
 *
 *  1. What the letter sorts as, ignoring accents (`Intl.Collator`, English).
 *     This knows ß is ss and ø is o.
 *  2. The same question in the languages the letter belongs to. Danish knows þ
 *     is th; English does not, because English never writes the letter.
 *  3. What the letter becomes in capitals and back (`toUpperCase`). This is the
 *     one that knows the dotless Turkish ı is i, which no sorting order says,
 *     because in Turkish they are genuinely different letters.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Where the answers are written. Beside the fold that reads them, because it is
// the only thing that does.
const OUT_FILE = fileURLToPath(
	new URL(
		'../packages/research/src/application/letter-equivalences.generated.ts',
		import.meta.url,
	),
)

// The Latin letters, which is as far as this goes. A name in another alphabet —
// Greek, Cyrillic, Arabic — needs a fold built for that alphabet, not a
// spelling of it in a–z.
const FIRST_POINT = 0x00c0
const LAST_POINT = 0x024f

// Asked in this order. English first because it places most letters; the rest
// are the languages that actually write the letters English cannot place, so
// the question is put to somebody who uses them.
const LANGUAGES = [
	'en',
	'da',
	'is',
	'tr',
	'sv',
	'nb',
	'pl',
	'hu',
	'ro',
] as const

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

// What a letter may turn out to stand for: one plain letter, or two. Two is
// needed because ß is ss and œ is oe; nothing in this range needs three.
const CANDIDATES: ReadonlyArray<string> = [
	...LETTERS,
	...LETTERS.flatMap(first => LETTERS.map(second => first + second)),
]

// A letter as the fold has it by the time it consults this table: taken apart,
// accent marks off, lower-cased. Written the same way here so the two cannot
// disagree about which letters are still left to answer for.
const asTheFoldSeesIt = (letter: string): string =>
	letter
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()

// Whether the fold has already dealt with this letter before it reaches the
// table — either by turning it into plain letters (é into e), or by turning it
// into some OTHER letter that the table answers for in its own right (ǽ into æ).
// Both would read as rows the fold needs and neither is ever looked up.
const foldedAlready = (letter: string): boolean =>
	/^[a-z]+$/.test(asTheFoldSeesIt(letter)) || asTheFoldSeesIt(letter) !== letter

const sortsAs = (letter: string, language: string): string | undefined => {
	const collator = new Intl.Collator(language, { sensitivity: 'base' })
	return CANDIDATES.find(candidate => collator.compare(letter, candidate) === 0)
}

// What the letter becomes written in capitals and lowered again. For most
// letters this gives the letter back; for a few it lands on plain letters, which
// is the only place the answer for ı comes from.
const capitalisedAs = (letter: string): string | undefined => {
	const roundTripped = letter.toUpperCase().toLowerCase()
	return roundTripped !== letter && /^[a-z]+$/.test(roundTripped)
		? roundTripped
		: undefined
}

const equivalences = new Map<string, string>()
const unplaceable: Array<string> = []

for (let codePoint = FIRST_POINT; codePoint <= LAST_POINT; codePoint++) {
	const letter = String.fromCodePoint(codePoint)
	// The multiplication and division signs sit in this range and are not
	// letters; nothing spells a company with them.
	if (!/\p{Letter}/u.test(letter)) continue
	// Only the lower-case form: the fold lowercases before it reads this table.
	if (letter.toLowerCase() !== letter) continue
	if (foldedAlready(letter)) continue

	const found =
		LANGUAGES.reduce<string | undefined>(
			(answer, language) => answer ?? sortsAs(letter, language),
			undefined,
		) ?? capitalisedAs(letter)

	if (found === undefined) unplaceable.push(letter)
	else equivalences.set(letter, found)
}

const rows = [...equivalences]
	.map(([letter, plain]) => `\t['${letter}', '${plain}'],`)
	.join('\n')

// How many of the left-out letters are listed on one comment line below.
const LETTERS_PER_LINE = 26

writeFileSync(
	OUT_FILE,
	`// Generated by scripts/derive-letter-equivalences.ts — do not edit by hand.
// Re-run \`pnpm derive-letter-equivalences\` to refresh it.
//
// Which plain letters a letter outside a–z stands for, so a company whose name
// is spelled with one is still found at the web address it registered: a firm
// called Straßenbau lives at strassenbau.de, and Nørgaard at norgaard.dk.
//
// Every row was read out of the Unicode data Node ships rather than typed here.
//
// ${unplaceable.length} letters in the same range are left out, because no language in that
// data places them against plain letters at all${
		unplaceable.length > 0
			? `:
${unplaceable
	.reduce<Array<Array<string>>>((lines, letter) => {
		const last = lines.at(-1)
		if (last === undefined || last.length >= LETTERS_PER_LINE)
			lines.push([letter])
		else last.push(letter)
		return lines
	}, [])
	.map(line => `//   ${line.join(' ')}`)
	.join('\n')}
// They keep their own spelling and so still find nothing. They are letters of
// languages this product has never been asked about; placing them would need a
// fold that knows those languages, not a spelling of them in a–z.`
			: '.'
	}
export const EQUIVALENT_LETTERS: ReadonlyMap<string, string> = new Map([
${rows}
])
`,
	'utf8',
)

process.stdout.write(
	`${equivalences.size} letters placed, ${unplaceable.length} left (${unplaceable.join(' ') || 'none'})\n`,
)
