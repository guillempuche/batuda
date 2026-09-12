import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { apiBaseUrl } from './api-base'
import { useHydrated } from './use-hydrated'

// Browser-side Better Auth client. Plugins mirror the server's plugin tuple
// in apps/server/src/lib/auth.ts so the client and server agree on the
// shape of session.activeOrganizationId, organization payloads, member
// fields, etc.
//
// `magicLinkClient` backs sign-in — someone asks for their own link from
// /login and follows it. `organizationClient` exposes
// auth.organization.{setActive, listMembers, getFullOrganization,
// removeMember, ...} in the browser without re-implementing them against the
// raw fetch. Adding a member goes through Batuda's own `POST /v1/members`
// instead, because that path needs a role check Better Auth does not do.
//
// Base URL resolution lives in `api-base.ts` — empty in dev (same-origin
// via Vite proxy keeps the session cookie reachable), absolute API
// origin in prod. The server mounts the auth handler at `/auth/*`, NOT
// at the Better Auth default `/api/auth/*` — so `basePath` is set
// explicitly. Without it, every authClient query 404s and the React
// atoms never hydrate (the org switcher renders "No active
// organization" forever).
const base = apiBaseUrl()

export const authClient = createAuthClient({
	baseURL: base || undefined,
	basePath: '/auth',
	plugins: [organizationClient(), magicLinkClient()],
})

/*
 * The store behind these hooks lives in the browser only, so the server always
 * renders its "nothing known yet" branch. The browser's copy can already hold
 * the answer by the time React matches the server's HTML, and rendering it at
 * that moment makes React throw the subtree away and rebuild it. These wrappers
 * hold the answer back until hydration is over, so the first browser render
 * matches the server and the real data lands one render later. Read the stores
 * through them, never through `authClient.use…` directly.
 */

function withheldUntilHydrated<T extends { data: unknown }>(
	result: T,
	hydrated: boolean,
): Omit<T, 'data'> & { readonly data: T['data'] | undefined } {
	return hydrated ? result : { ...result, data: undefined }
}

/** The signed-in person's session, once the browser is allowed to know it. */
export function useHydratedSession() {
	return withheldUntilHydrated(authClient.useSession(), useHydrated())
}

/** The active organisation with its members, once the browser may know it. */
export function useHydratedActiveOrganization() {
	return withheldUntilHydrated(
		authClient.useActiveOrganization(),
		useHydrated(),
	)
}

/** Every organisation the person belongs to, once the browser may know it. */
export function useHydratedListOrganizations() {
	return withheldUntilHydrated(authClient.useListOrganizations(), useHydrated())
}
