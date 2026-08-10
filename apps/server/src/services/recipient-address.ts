/**
 * The bare mailboxes a message is going to, however the caller wrote them.
 *
 * Both email gates — the block on addresses that bounced, and the question an
 * assistant is asked about a doubtful one — compare what the caller passed
 * against `channels.address`, which holds a bare address and nothing else. A
 * caller may perfectly reasonably write a recipient the way a mail client shows
 * it, and the mail server accepts every one of these:
 *
 *     Núria Pla <nuria@example.cat>
 *     "Pla, Núria" <nuria@example.cat>
 *     a@example.cat, b@example.cat
 *
 * Compared as written, none of them matches a stored address, so the message
 * goes out with neither gate having recognised the recipient — including to a
 * mailbox that hard-bounced. Pulling the address out of each form is what makes
 * the two gates see what the mail server will actually deliver to.
 *
 * Everything is folded to one spelling, since an address differing only by case
 * is the same mailbox and must not read as a different one.
 */

// Anything inside angle brackets is the address; the rest is a display name.
// Mail clients quote a name containing a comma, so the split below has to look
// past quoted sections or "Pla, Núria" <a@b> becomes two broken recipients.
const splitOnUnquotedCommas = (value: string): string[] => {
	const parts: string[] = []
	let current = ''
	let inQuotes = false
	let inAngles = false
	for (const char of value) {
		if (char === '"') inQuotes = !inQuotes
		else if (char === '<') inAngles = true
		else if (char === '>') inAngles = false
		if (char === ',' && !inQuotes && !inAngles) {
			parts.push(current)
			current = ''
			continue
		}
		current += char
	}
	parts.push(current)
	return parts
}

const bareAddress = (value: string): string => {
	const angled = value.match(/<([^>]*)>/)
	return (angled?.[1] ?? value).trim().toLowerCase()
}

/**
 * Where a reply to this message goes.
 *
 * A reply is addressed to whoever wrote the thing it answers. On a message that
 * came in, that is the sender — the `to` on such a row is our own mailbox, so
 * replying to it would send the message back to ourselves. On one we sent, the
 * people it went to are already the right ones.
 *
 * Both the send and the check that runs before it ask this, and they have to
 * agree: a guard that judges one mailbox while the message goes to another is
 * worse than no guard, because it reads as having checked.
 *
 * Falling back to `to` covers messages stored before the sender was written
 * down — wrong for those, but no more wrong than it already was, and it never
 * leaves a reply with nobody to go to.
 */
export const replyAddressees = (message: {
	readonly direction: string
	readonly recipients: {
		readonly from?: string | null
		readonly to?: ReadonlyArray<string>
	} | null
}): ReadonlyArray<string> =>
	message.direction === 'inbound' && message.recipients?.from
		? [message.recipients.from]
		: (message.recipients?.to ?? [])

/**
 * Every distinct mailbox named across the lists given, in the form the database
 * stores. Empty entries are dropped rather than compared, since an empty string
 * matches nothing and only widens the query.
 */
export const recipientAddresses = (
	...lists: ReadonlyArray<string | ReadonlyArray<string> | undefined>
): string[] => [
	...new Set(
		lists
			.flatMap(list =>
				list === undefined ? [] : typeof list === 'string' ? [list] : [...list],
			)
			.flatMap(splitOnUnquotedCommas)
			.map(bareAddress)
			.filter(address => address !== ''),
	),
]
