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
 */

// The backslash escapes itself first, so a typed backslash cannot turn the
// character after it into an instruction.
const asPlainText = (typed: string): string =>
	typed.replace(/[\\%_]/g, match => `\\${match}`)

/** Rows whose column holds this text anywhere in it. */
export const textAnywhere = (typed: string): string => `%${asPlainText(typed)}%`

/** Rows whose column starts with this text — what a name-completion asks for. */
export const textAtTheStart = (typed: string): string =>
	`${asPlainText(typed)}%`
