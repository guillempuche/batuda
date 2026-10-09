/**
 * Whether a value a run wrote into a registration-number field could be a
 * registration number at all.
 *
 * A run reading a legal notice meets the company's registered name and its
 * number on the same line, and writes the name into the number's field often
 * enough that one reached a CRM record as "INGENIERÍA Y GESTIÓN DE ESPACIOS
 * INDUSTRIALES, SL". This is a reading rule, not a definition of the field: it
 * says what a run may put there, and a person typing a number is held to
 * nothing here.
 *
 * Every register this serves writes its numbers mostly in digits with at most
 * a short prefix or suffix — a Spanish CIF ("B12345678", "ESB12345678"), a UK
 * company number ("01234567"), a French SIREN with or without the court
 * ("552 100 554", "RCS Paris B 552 100 554"), a German commercial-register
 * entry ("HRB 12345 B"), an Italian or Portuguese fiscal number. A legal name
 * has the opposite shape: many letters and at most a year's worth of digits.
 *
 * Zero dependencies, so code outside the research run can import it without
 * pulling the application layer in.
 */

/** Fewer digits than this is a year or a street number, never a register. */
const FEWEST_DIGITS = 5

/**
 * The words a register line writes around its number — the register, the
 * court, the kind of number. They say what the number is, not which company
 * it belongs to, so they are left out of the counts below: "Amtsgericht
 * Charlottenburg HRB 12345 B" is a town and a letter once they go.
 */
const REGISTER_WORDS = new Set([
	'ag',
	'amtsgericht',
	'btw',
	'cif',
	'companies',
	'company',
	'hoja',
	'house',
	'hra',
	'hrb',
	'iva',
	'kvk',
	'nie',
	'nif',
	'nipc',
	'no',
	'nº',
	'num',
	'number',
	'nummer',
	'partita',
	'rea',
	'rcs',
	'siren',
	'siret',
	'vat',
])

/**
 * More letters than this, once the register's own words are gone, is a name:
 * the longest court towns ("Charlottenburg", "Frankfurt am Main") stay under
 * it, and a legal name beside its number ("Espacios Industriales SL") does not.
 */
const MOST_LETTERS = 20

/**
 * More words of letters than this is a sentence about the number, not where
 * it is kept: a town of three parts ("Frankfurt am Main", "Aix-en-Provence")
 * is three, and "the CIF is … as printed" is four. A single letter, like the
 * "B" in a French entry, is not a word.
 */
const MOST_WORDS = 3

/** A number longer than this has something else written beside it. */
const MOST_CHARS = 40

/**
 * Digits that are not a register's: a page's own contact line, a date, a bank
 * account, a street address. Each has a shape of its own that a register
 * number never takes, so each is refused on that shape rather than counted.
 */
const NOT_A_REGISTER = [
	// An email address.
	/@/u,
	// A telephone number: a leading plus, or a telephone word before it.
	/^\+|\b(?:tel|tlf|tfno|phone|fax|m[oó]vil|mobile)\b/iu,
	// A date, written either way round.
	/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/.]\d{2}[/.]\d{4}\b/u,
	// A bank account: the word, or a country code and check digits ahead of a
	// long run of digits in groups of four.
	/\biban\b|\b[a-z]{2}\d{2}(?:[ ]?[a-z0-9]{4}){3,}/iu,
	// A street or a postcode line.
	/\b(?:calle|carrer|avenida|avinguda|av|avda|plaza|plaça|rue|avenue|street|st|road|straße|strasse|str|cp|c\.p)\b|^c\//iu,
]

export const looksLikeRegistrationNumber = (value: string): boolean => {
	// Composed first, so an accented letter written as a base letter plus a
	// mark is one letter and not a word break.
	const trimmed = value.normalize('NFC').trim()
	if (trimmed === '' || trimmed.length > MOST_CHARS) return false
	if (NOT_A_REGISTER.some(shape => shape.test(trimmed))) return false
	const digits = (trimmed.match(/\p{Nd}/gu) ?? []).length
	const words = (trimmed.match(/\p{L}{2,}/gu) ?? []).filter(
		word => !REGISTER_WORDS.has(word.toLowerCase()),
	)
	const letters = words.reduce((sum, word) => sum + word.length, 0)
	return (
		digits >= FEWEST_DIGITS &&
		letters <= MOST_LETTERS &&
		words.length <= MOST_WORDS
	)
}
