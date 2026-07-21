import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { apiBaseUrl } from './api-base'

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
