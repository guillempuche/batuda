/**
 * Folding a written name down to the form two spellings of the same thing share.
 *
 * "Metal fabrication", "metal Fabrication" and "Metal-fabricació" are one trade
 * written three ways, and a list that keeps all three is a list nobody can group
 * by. The fold is what decides they are the same, so it is also what a uniqueness
 * rule can be built on.
 *
 * It keeps letters and digits of every writing system rather than only the Latin
 * ones. The narrower rule looks equivalent until a name is Japanese, Cyrillic or
 * Arabic, at which point every one of them folds to nothing and — under a
 * uniqueness rule — silently becomes the same entry as the first. Norwegian ø,
 * German ß, Polish ł and Croatian đ fail the narrow rule too: they are single
 * letters rather than a letter with a mark added, so stripping marks never
 * reaches them.
 *
 * ## Which marks come off, and why it is decided by the LETTER
 *
 * A mark over a letter is decoration in some writing systems and a different
 * letter in others. A Greek shopfront writes ΜΕΤΑΦΟΡΕΣ with no accent at all, and
 * Arabic and Hebrew are normally written with no pointing — so those marks come
 * off, and a reader who leaves them out still finds the trade. Japanese ハ and バ
 * are two kana, Russian и and й are two letters of the alphabet, Thai เขา is "he"
 * where เข่า is "knee" — so those marks stay, and taking them off hands back the
 * wrong trade under a rule that says two names are one.
 *
 * Nothing about the MARK can decide this, which is the trap worth writing down:
 * the breve on Russian й and the breve on Romanian ă are the same character,
 * U+0306. So the letter underneath is what is read, never the mark itself.
 *
 * Loose accents come off first — "´" and "·" typed as characters of their own,
 * never letters. The order matters: a Greek accent character decomposes into one
 * of these sitting on top of a combining mark, and taking the loose one away
 * leaves the mark beside the letter it belongs to, where the rule below can read
 * it.
 *
 * A mark that is kept is a LETTER here, so it stays out of the run-of-anything
 * class below. Leaving it there put a space where a Thai vowel or a Hindi matra
 * stands and cut one word into three: "निर्माण" was stored as "न रम ण".
 *
 * ## What is stored
 *
 * What this produces is STORED, as `company_industries.folded_key`, with a
 * uniqueness rule standing on it — so a change here means every key already
 * written means something else, and the change travels with a migration that
 * rewrites those rows and merges the ones that become the same. No Latin or Greek
 * name folds differently than it did, which is what lets such a migration touch
 * only the rows it has to.
 *
 * The research package's fold writes a letter it cannot spell out instead
 * ("Straße" → "strasse"), and the two differ ON PURPOSE — that one is never
 * stored.
 */

import { EQUIVALENT_LETTERS } from './letter-equivalences.generated'

// The letters a company itself writes out when it registers an address, so a slug
// can spell one it cannot otherwise use. Read from the same table the rest of the
// product reads, rather than a second list that would drift from it.
const LETTERS_TO_REWRITE = new RegExp(
	`[${[...EQUIVALENT_LETTERS.keys()].join('')}]`,
	'gu',
)

// Letters whose marks are decoration a reader can leave off. Written as the
// scripts rather than as the marks, because the same mark means different things
// under different letters.
const DECORATIVE_MARK =
	/([\p{Script=Latin}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu

// A mark the rules above left standing with no letter under it — one written
// between two spaces, or opening a name. Kept marks are the letters of the words
// they sit in, and one sitting in no word is not part of any name: left in, it
// becomes a word of its own, and the same trade typed without it is a second row.
const MARK_UNDER_NO_LETTER = /(^|[^\p{L}])\p{M}+/gu

// An accent typed as a character in its own right — "´", "¨", "·" — rather than
// one sitting over a letter. Never a letter itself, so it always comes off.
const LOOSE_ACCENT = /(?!\p{M})\p{Diacritic}/gu

// Everything that is neither a letter, a digit, nor a mark kept as part of one.
const RUN_OF_ANYTHING_ELSE = /[^\p{L}\p{N}\p{M}]+/gu

const HAS_A_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * The comparison form of a written name: decorative marks removed, lower case,
 * and every run of anything else turned into one space. Returns an empty string
 * for a name with no letters or digits in it at all, which callers must refuse
 * rather than store — an empty fold matches every other empty fold.
 */
export const foldLabel = (raw: string): string => {
	const folded = raw
		.normalize('NFD')
		.replace(LOOSE_ACCENT, '')
		.replace(DECORATIVE_MARK, '$1')
		.replace(MARK_UNDER_NO_LETTER, '$1')
		.toLowerCase()
		.replace(RUN_OF_ANYTHING_ELSE, ' ')
		.trim()
		// Korean comes apart into the pieces its letters are built from, and a key
		// written as those pieces is a key nobody typing the name would produce.
		.normalize('NFC')

	// A mark left standing on its own is not a name, and a key that names nothing
	// matches every other key that names nothing.
	return HAS_A_LETTER_OR_DIGIT.test(folded) ? folded : ''
}

/**
 * The same name as it appears in a web address. Derived from the fold so that a
 * name and its slug can never disagree about which trade they mean. Not
 * guaranteed to be plain ASCII — a Japanese trade keeps its characters — so a
 * caller putting one in a URL encodes it.
 */
export const slugFromLabel = (raw: string): string =>
	foldLabel(raw).replaceAll(' ', '-')

// A web address holds plain letters and digits, so everything else goes. The fold
// above keeps a name's own characters on purpose — that is what makes two spellings
// of one trade meet — but a slug is read by browsers and typed by people, so it
// keeps only what every one of them handles.
const NOT_PLAIN = /[^a-z0-9]+/g
const EDGE_DASHES = /^-+|-+$/g

// Long enough for any name to still be recognisable, short enough for an address
// bar. A dash left hanging by the cut comes off, so a slug never ends in one.
const SLUG_MAX_CHARS = 60

// A short code standing for a name, the same every time that name is written, so a
// company sent twice is recognised as the one already on file rather than written
// again as a second company. The two constants are FNV-1a's own — any small mixing
// function would do, since nothing here rests on it being hard to guess.
const stableCode = (value: string): string => {
	let hash = 0x811c9dc5
	for (const character of value.normalize('NFC')) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(36).padStart(6, '0').slice(-6)
}

/**
 * A company's web address form, worked out from its name.
 *
 * Two kinds of name it has to handle, and they fail in opposite directions if the
 * caller is left to guess. An accented one is ordinary in the markets this serves —
 * "Calderería Sentmenat" — and a caller writing the accent straight into a slug has
 * it refused, taking the whole batch down with it. A name with no a-z in it at all —
 * "北京科技有限公司" — leaves nothing to build an address from, and a caller stripping
 * what it cannot use is left with an empty string and reaches for a random one,
 * which erases the company's identity and differs on every resend.
 *
 * So the accents come off, and a name with no plain letters is given a short code
 * standing for the whole name rather than a random one: still not readable, but the
 * same every time, so sending the same company twice recognises it rather than
 * writing it again.
 */
export const companySlugFromName = (name: string): string => {
	const plain = slugFromLabel(name)
		// A letter that stands for plain letters is written as those, because that is
		// what the company registers itself: Straßenbau lives at strassenbau.de.
		// Dropping it as unusable instead cut the word in half — "strasse" became
		// "stra-e" — and the same goes for Nørgaard, Łukasz and Đurđević.
		.replace(LETTERS_TO_REWRITE, letter => EQUIVALENT_LETTERS.get(letter) ?? '')
		.replace(NOT_PLAIN, '-')
		.replace(EDGE_DASHES, '')
		.slice(0, SLUG_MAX_CHARS)
		.replace(EDGE_DASHES, '')
	return plain === '' ? `company-${stableCode(name)}` : plain
}
