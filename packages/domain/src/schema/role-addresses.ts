/**
 * Whether an email address is a shared mailbox rather than one person's.
 *
 * `info@`, `hola@`, `sales@` are answered by whoever is on duty. Treating one as
 * a person invents somebody who does not exist — a contact named after an
 * address, who can then be assigned a task, greeted by name in a template, or
 * counted as a decision-maker.
 *
 * Kept here rather than in the research or email package because both ask the
 * same question of the same addresses, and two copies of this list would drift
 * apart quietly: a word added to one would keep inventing people in the other.
 */

// Role / department local parts across the languages the product works in. A
// person's name is never in this list, so only shared mailboxes match.
const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set([
	'info',
	'contact',
	'contacto',
	'contacte',
	'sales',
	'ventas',
	'vendes',
	'press',
	'media',
	'hello',
	'hola',
	'support',
	'soporte',
	'suport',
	'office',
	'admin',
	'enquiries',
	'billing',
	'facturacio',
	'facturacion',
	'noreply',
	'no-reply',
	'donotreply',
])

/**
 * True when the address is a shared mailbox. The part before the `@` is compared
 * with its `+tag` suffix removed, so `info+web@acme.com` reads as `info`.
 */
export const isRoleAddress = (email: string): boolean => {
	const at = email.lastIndexOf('@')
	if (at <= 0) return false
	const localPart = email.slice(0, at).trim().toLowerCase().split('+')[0] ?? ''
	return ROLE_LOCAL_PARTS.has(localPart)
}
