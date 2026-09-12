import { createContext } from 'react'

/** Who is signed in, as the server tells the browser: no token, no dates. */
export type IdentityPerson = {
	readonly id: string
	readonly email: string
	readonly name: string
}

/** One membership of the active organisation, as far as a screen reads it. */
export type IdentityMember = {
	readonly id: string
	readonly userId: string
	readonly role: string
	readonly user: { readonly name?: string | undefined; readonly email: string }
}

/** The active organisation with the people in it. */
export type IdentityOrganization = {
	readonly id: string
	readonly name: string
	readonly slug: string
	readonly members: ReadonlyArray<IdentityMember>
}

/** An organisation the person belongs to, enough to list and switch to it. */
export type IdentityOrganizationSummary = {
	readonly id: string
	readonly name: string
	readonly slug: string
}

/**
 * What the server learnt about the visitor while rendering the page. Each
 * field is a value, `null` for "asked, there is none", or `undefined` for
 * "could not ask". The whole object is absent on a page the browser rendered
 * for itself.
 */
export type ServerIdentity = {
	readonly person: IdentityPerson | null
	readonly activeOrganization: IdentityOrganization | null | undefined
	readonly organizations: ReadonlyArray<IdentityOrganizationSummary> | undefined
}

export const ServerIdentityContext = createContext<ServerIdentity | undefined>(
	undefined,
)

/** Makes the server's answers available to the auth hooks. Mounted once, by the root route. */
export const ServerIdentityProvider = ServerIdentityContext.Provider

type StoreResult = { readonly data: unknown; readonly isPending: boolean }

/**
 * Better Auth's store lives in the browser only, so on its own the server
 * would draw every page as if nobody were signed in, and the browser's copy
 * could already hold the answer by the time React matches the server's HTML:
 * a different tree, which makes React throw the subtree away and rebuild it.
 * So both sides draw the server's answer first, and the live store takes over
 * once it has an answer of its own.
 *
 * `server` is the server's answer: a value, `null` for "there is none", or
 * `undefined` for "not known", in which case the store is shown exactly as it
 * would be without any handover, pending state included.
 */
export function serverFirst<T extends StoreResult, S>(
	live: T,
	server: S | null | undefined,
	hydrated: boolean,
): Omit<T, 'data' | 'isPending'> & {
	readonly data: T['data'] | S | undefined
	readonly isPending: boolean
} {
	if (server === undefined) {
		return hydrated ? live : { ...live, data: undefined }
	}
	const storeHasAnswered = !live.isPending || live.data != null
	if (hydrated && storeHasAnswered) return live
	return { ...live, data: server ?? undefined, isPending: false }
}

/** Whether a role may manage the organisation: its owners and admins. */
export function isOrgAdmin(role: string | null | undefined): boolean {
	return role === 'owner' || role === 'admin'
}
