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
 */

/**
 * The comparison form of a written name: accents removed, lower case, and every
 * run of anything else turned into one space. Returns an empty string for a name
 * with no letters or digits in it at all, which callers must refuse rather than
 * store — an empty fold matches every other empty fold.
 *
 * A letter that is not an accented a–z one keeps itself here: "Straße" folds to
 * "straße", not "strasse". The research package's fold writes such a letter out
 * instead, and the two differ ON PURPOSE — what this one produces is STORED, as
 * `company_industries.folded_key`, with a uniqueness rule standing on it. Change
 * it and every key already written means something else, so making the two agree
 * is a migration that rewrites those rows, never an edit to this line.
 */
export const foldLabel = (raw: string): string =>
	raw
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()

/**
 * The same name as it appears in a web address. Derived from the fold so that a
 * name and its slug can never disagree about which trade they mean. Not
 * guaranteed to be plain ASCII — a Japanese trade keeps its characters — so a
 * caller putting one in a URL encodes it.
 */
export const slugFromLabel = (raw: string): string =>
	foldLabel(raw).replaceAll(' ', '-')
