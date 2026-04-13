import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'

/**
 * Read the incoming request's cookie header during SSR.
 *
 * Wrapped in `createServerFn` so that `@tanstack/react-start/server`
 * never appears in the client bundle — the TanStack Start compiler
 * replaces the handler with an RPC stub on the client side.
 *
 * Call this only inside SSR-gated code paths (`import.meta.env.SSR`).
 * On client navigations the browser attaches session cookies
 * automatically via `credentials: 'include'`.
 */
export const getServerCookieHeader = createServerFn().handler(async () => {
	return getRequestHeader('cookie') ?? null
})
