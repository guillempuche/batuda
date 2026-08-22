// How a subject line says "this answers something".
//
// Mail clients write the prefix several ways — "RE:", "re:", and with French
// typography "Re :" — and every one of them already marks a reply. Reading it
// one way in one place and another way somewhere else is how a subject ends up
// stacked into "Re: Re : quote", or how one send path refuses what another
// allows. So the rule lives here, and the server and the web app both read it.
//
// Not every client writes it in English. A German one writes "AW:", a Dutch one
// "Antw:", a Scandinavian one "SV:", a Polish one "Odp:" — each already a reply,
// each stacked into "Re: AW: …" by a rule that only knows the English one, and
// each invisible to the check that refuses a reply answering nothing.
//
// The list stays short on purpose. Every entry added is a subject that can no
// longer be sent as an ordinary message, so a prefix that doubles as a normal
// word ("R:", "VS:") is left out: refusing somebody's real message costs more
// than missing a rare prefix.
const REPLY_PREFIX = /^\s*(?:re|aw|antw|sv|odp)\s*:/i

/** Whether this subject already reads as a reply. */
export const isReplySubject = (subject: string): boolean =>
	REPLY_PREFIX.test(subject)

/** The subject a reply goes out under: prefixed once, never twice. */
export const withReplyPrefix = (subject: string): string =>
	isReplySubject(subject) ? subject : `Re: ${subject}`
