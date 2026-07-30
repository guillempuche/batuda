import { Schema } from 'effect'

/**
 * What part a person plays in deciding whether their company buys.
 *
 * This replaces a single yes/no "is this the decision maker". That question has
 * one right answer in an owner-run business, where the owner decides everything,
 * and no right answer anywhere else. In a factory the plant manager, purchasing
 * and quality all sign; in a hospital the named head is reached through a
 * procurement office that can stop the whole thing without ever being the buyer.
 * A yes/no forced all of those into one person and lost the rest.
 *
 * Several people holding a part between them is the normal case, and is what
 * these express: one person per row, as many rows as the company has.
 *
 * The yes/no was also lying about its own shape — a boolean in the database and
 * a nullable one in the model, so it already had three states while pretending
 * to have two. "Nobody has said" is a real answer and is spelled null here.
 */
export const BUYING_ROLES = [
	// Holds the budget. Says yes and it is paid for.
	'economic_buyer',
	// Wants it to happen and argues for it inside the company. Cannot approve the
	// spend alone, and no deal is won without one.
	'champion',
	// Controls access — procurement, an assistant, a practice manager. Cannot say
	// yes, can say no, and is reached before anybody who can say yes.
	'gatekeeper',
	// Judges whether the thing actually works. A veto on the merits.
	'technical_evaluator',
	// Lives with it day to day. Rarely decides, often the reason a decision holds.
	'user',
] as const

export const BuyingRole = Schema.Literals(BUYING_ROLES)
export type BuyingRole = typeof BuyingRole.Type

// The parts that can move a purchase forward. A gatekeeper can stop one and an
// evaluator can sink one, but neither carries it — so "who is worth reaching" is
// these two, which is the question the old yes/no was really being asked.
//
// Picked out of the list above rather than written out again, so renaming a part
// there cannot quietly leave this one behind still naming the old word.
const DECIDING: ReadonlySet<BuyingRole> = new Set(
	BUYING_ROLES.filter(role => role === 'economic_buyer' || role === 'champion'),
)

/**
 * Whether this person can carry a purchase forward. Null — nobody has said what
 * part they play — is not a yes.
 */
export const decidesPurchase = (role: string | null | undefined): boolean =>
	role != null && (DECIDING as ReadonlySet<string>).has(role)

/** Whether a stored value is one of the parts this vocabulary knows. */
export const isBuyingRole = (role: string): role is BuyingRole =>
	(BUYING_ROLES as ReadonlyArray<string>).includes(role)
