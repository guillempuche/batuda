import { Schema } from 'effect'

/**
 * What a deliverability check said about an email address.
 *
 * Only the email channel carries one. It is read at the moment of sending: a
 * verdict that is anything other than `deliverable` makes the send path stop and
 * ask, while no verdict at all sails through — there is no evidence the address
 * is bad. That asymmetry is why the word matters and why the list is closed.
 *
 * It used to be free text at every door, which is how a word nothing understands
 * ended up stored on real addresses. Anything outside this list is refused now.
 */
export const VERIFICATION_VERDICTS = [
	// A mailbox answered. The only word that lets a send go through unremarked.
	'deliverable',
	// Something is off — a full mailbox, a disposable domain, a server that
	// stalled. Might arrive, might not.
	'risky',
	// The domain accepts everything, so the check learned nothing about this
	// particular address.
	'catch_all',
	// The mailbox is not there.
	'undeliverable',
	// Checked and inconclusive, or somebody withdrew an earlier claim.
	'unknown',
] as const

export const VerificationVerdict = Schema.Literals(VERIFICATION_VERDICTS)
export type VerificationVerdict = typeof VerificationVerdict.Type

/** Whether a stored value is one of the verdicts this vocabulary knows. */
export const isVerificationVerdict = (
	verdict: string,
): verdict is VerificationVerdict =>
	(VERIFICATION_VERDICTS as ReadonlyArray<string>).includes(verdict)

/**
 * The verdicts a person or an assistant may set by hand.
 *
 * Every one of them takes trust away; none of them grants it. `deliverable` and
 * `catch_all` are things a checker found out by knocking on a mailbox — nobody
 * at a keyboard obtained either — and `deliverable` is the single word that opens
 * the send path, so a caller able to write it could talk its own way past the
 * check. `unknown` is the way back: it withdraws a claim somebody disagrees with
 * without asserting a good one in its place.
 *
 * Picked out of the list above rather than written again, so a rename there
 * cannot quietly leave this one naming a word that no longer exists.
 */
export const HandSetVerificationVerdict = VerificationVerdict.pick([
	'risky',
	'undeliverable',
	'unknown',
])
export type HandSetVerificationVerdict = typeof HandSetVerificationVerdict.Type
