/**
 * What somebody typed into a search box, ready to go into a SQL `LIKE` pattern.
 *
 * `LIKE` reads two characters as instructions rather than as text: `%` means
 * "anything at all here" and `_` means "any one character". So a search for "50%"
 * asks for every row rather than for the rows saying 50%, and a search for "a_b"
 * reaches "axb". Somebody typing those characters means the characters.
 *
 * The pattern is built here rather than handed back for a caller to wrap, because
 * a caller that has to remember to wrap it is a caller that can forget: six of the
 * nine searches in this codebase did, each in the same way, while three wrote the
 * same escaping out by hand. There is nothing to remember if the finished pattern
 * is what comes back.
 *
 * Half of matching an accent lives here and half in the query: the column has to
 * be read the same way — `normalize(name) ILIKE ${textAnywhere(q)}` — because an
 * accent already stored can be written either way too, so neither half works
 * alone. A slug or an email address needs none of it: both are plain letters by
 * the time they are stored, so there is only one way to write them.
 *
 * Names and titles only, never the body of a document. Reading a whole document
 * that way is seven times slower — measured at 0.37s against 2.6s over twenty
 * thousand of them — and every search pays it. Finding a body by an accented word
 * wants a searchable copy kept alongside it.
 */

// The backslash escapes itself first, so a typed backslash cannot turn the
// character after it into an instruction.
//
// An accented letter is put into one form first, because there are two ways to
// write one and they do not match each other: an é can be a single character, or
// an e with a mark added after it, and a Mac hands over the second where a browser
// hands over the first. Somebody pasting "Calderería" from a file found nothing.
const asPlainText = (typed: string): string =>
	typed.normalize('NFC').replace(/[\\%_]/g, match => `\\${match}`)

/** Rows whose column holds this text anywhere in it. */
export const textAnywhere = (typed: string): string => `%${asPlainText(typed)}%`

/** Rows whose column starts with this text — what a name-completion asks for. */
export const textAtTheStart = (typed: string): string =>
	`${asPlainText(typed)}%`
