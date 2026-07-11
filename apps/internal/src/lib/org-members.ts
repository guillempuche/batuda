import { useMemo } from 'react'

import { authClient } from './auth-client'

export type OrgMemberInfo = {
	readonly userId: string
	readonly name: string
	readonly email: string
}

/**
 * The active org's member directory plus the current user id, read from Better
 * Auth's active-organization signal. Powers the owner name/initials on leads, the
 * owner picker, and the "my leads" filter.
 *
 * The signal is client-only, so `data` is undefined during SSR / first paint —
 * callers then get an empty directory and `undefined` lookups, which the UI
 * renders as a neutral placeholder rather than flashing wrong names.
 */
export function useOrgMembers(): {
	readonly members: ReadonlyArray<OrgMemberInfo>
	readonly byUserId: (
		id: string | null | undefined,
	) => OrgMemberInfo | undefined
	readonly meUserId: string | undefined
} {
	const active = authClient.useActiveOrganization()
	const session = authClient.useSession()

	const rawMembers = active.data?.members
	const meUserId = session.data?.user?.id

	return useMemo(() => {
		const list = (rawMembers ?? []) as ReadonlyArray<{
			userId: string
			user: { name: string | null; email: string }
		}>
		const members: ReadonlyArray<OrgMemberInfo> = list.map(m => ({
			userId: m.userId,
			// Fall back to the email when a member never set a display name.
			name: m.user.name ?? m.user.email,
			email: m.user.email,
		}))
		const index = new Map(members.map(m => [m.userId, m]))
		return {
			members,
			byUserId: (id: string | null | undefined) =>
				id ? index.get(id) : undefined,
			meUserId,
		}
	}, [rawMembers, meUserId])
}

/** First-letter avatar text, matching the members page's initial plate. */
export function initialFor(nameOrEmail: string): string {
	return (nameOrEmail.charAt(0) || '?').toUpperCase()
}
