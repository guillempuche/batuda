import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { useContext } from 'react'

import { apiBaseUrl } from './api-base'
import { ServerIdentityContext, serverFirst } from './identity'
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
const client = createAuthClient({
	baseURL: base || undefined,
	basePath: '/auth',
	plugins: [organizationClient(), magicLinkClient()],
})

// The store's own hooks stay inside this file: read them through the
// `useHydrated…` hooks below, which know what the server drew. Everything
// else (sign-in, sign-out, switching organisation, the mutations) is the
// client as it is.
const {
	useSession,
	useActiveOrganization,
	useListOrganizations,
	useActiveMember,
	...authClientWithoutStoreHooks
} = client
export const authClient = authClientWithoutStoreHooks

/** The signed-in person's session. */
export function useHydratedSession() {
	const server = useContext(ServerIdentityContext)
	const person = server?.person
	return serverFirst(
		useSession(),
		person === undefined ? undefined : person && { user: person },
		useHydrated(),
	)
}

/** The active organisation with its members. */
export function useHydratedActiveOrganization() {
	const server = useContext(ServerIdentityContext)
	return serverFirst(
		useActiveOrganization(),
		server?.activeOrganization,
		useHydrated(),
	)
}

/** Every organisation the person belongs to. */
export function useHydratedListOrganizations() {
	const server = useContext(ServerIdentityContext)
	return serverFirst(
		useListOrganizations(),
		server?.organizations,
		useHydrated(),
	)
}

/** The person's own membership of the active organisation, role included. */
export function useHydratedActiveMember() {
	const server = useContext(ServerIdentityContext)
	// The server hands the organisation over with its members, so the person's
	// own row is read off it rather than asked for separately.
	const organization = server?.activeOrganization
	const member =
		organization === undefined || server?.person == null
			? undefined
			: organization === null
				? null
				: (organization.members.find(
						member => member.userId === server.person?.id,
					) ?? null)
	return serverFirst(useActiveMember(), member, useHydrated())
}
