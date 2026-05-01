import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// Browser-side Better Auth client. Plugins mirror the server's plugin tuple
// in apps/server/src/lib/auth.ts so the client and server agree on the
// shape of session.activeOrganizationId, organization payloads, member
// fields, etc.
//
// `magicLinkClient` is registered to round-trip the invitation flow once
// Slice 5 lands; `organizationClient` exposes auth.organization.{setActive,
// listMembers, getFullOrganization, inviteMember, acceptInvitation, ...}
// in the browser without re-implementing them against the raw fetch.
//
// `baseURL` points at the API origin (e.g. https://api.batuda.localhost in
// dev). The server mounts the auth handler at `/auth/*`, NOT at the
// Better Auth default `/api/auth/*` — so we override `basePath` to match.
// Without this, every authClient query 404s and the React atoms never
// hydrate (the org switcher renders "No active organization" forever).
const SERVER_URL =
	(typeof import.meta !== 'undefined' &&
		import.meta.env?.['VITE_SERVER_URL']) ||
	''

export const authClient = createAuthClient({
	baseURL: SERVER_URL || undefined,
	basePath: '/auth',
	plugins: [organizationClient(), magicLinkClient()],
})
