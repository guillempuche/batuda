// Pure helpers for the pending-invitations list on the members page. Kept
// framework-free so the filter/sort/expiry rules are unit-testable without a
// browser: the members route imports these and renders the result.

// Better Auth's client revives ISO timestamps into `Date` objects, so the
// route hands us `Date`s; strings are accepted too so the helpers stay easy to
// exercise from tests and survive any non-revived path.
export interface InvitationLike {
	readonly id: string
	readonly email: string
	readonly role: string
	readonly status: string
	readonly expiresAt: Date | string
	readonly createdAt: Date | string
}

export type InvitationDisplayStatus = 'pending' | 'expired'

/**
 * What badge a still-outstanding invitation should show. Better Auth keeps an
 * invite's stored status at `pending` right up until it is accepted, canceled,
 * or rejected — expiry is only enforced when the invitee tries to accept — so
 * the "Expired" state is derived here from the expiry timestamp, not read off
 * the row.
 *
 * An unparseable expiry is treated as still pending: a bad timestamp should
 * never make an outstanding invite look settled.
 */
export function invitationDisplayStatus(
	expiresAt: Date | string,
	now: number = Date.now(),
): InvitationDisplayStatus {
	const expiry = new Date(expiresAt).getTime()
	if (Number.isNaN(expiry)) return 'pending'
	return expiry < now ? 'expired' : 'pending'
}

/**
 * The invitations worth showing on the members page: only the ones still
 * outstanding (`status === 'pending'`), newest first. The full payload also
 * carries canceled/accepted/rejected rows, which are dropped here — so a
 * just-canceled invite disappears from the list on the next refetch.
 */
export function selectPendingInvitations<T extends InvitationLike>(
	invitations: ReadonlyArray<T>,
): ReadonlyArray<T> {
	return invitations
		.filter(invitation => invitation.status === 'pending')
		.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		)
}
