import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/* Which pages may be reached without a session. Everything else has to sit
 * under `routes/_authed/`, whose gate sends a signed-out visitor to the sign-in
 * page. A page created at the top level by mistake is reachable by anyone, and
 * nothing at runtime would say so, so the list is pinned here. */
const PUBLIC_ROUTE_FILES = [
	'__root.tsx',
	'login.tsx',
	'forgot-password.tsx',
	'reset-password.tsx',
	'oauth/consent.tsx',
]

const ROUTES_DIR = join(import.meta.dirname, '..', 'routes')

function routeFiles(dir: string, prefix = ''): Array<string> {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) return routeFiles(join(dir, entry.name), relative)
		return entry.name.endsWith('.tsx') ? [relative] : []
	})
}

describe('route tree', () => {
	describe('when a route file lives outside the signed-in layout', () => {
		it('should be one of the pages a signed-out visitor may see', () => {
			// GIVEN every route file the router will pick up
			const files = routeFiles(ROUTES_DIR)

			// WHEN the ones outside `_authed/` are singled out
			const outside = files.filter(file => !file.startsWith('_authed/'))

			// THEN each is a known public page; a new one has to be added here on
			// purpose or moved under `_authed/`
			expect(outside.sort()).toEqual([...PUBLIC_ROUTE_FILES].sort())
		})
	})

	describe('when a signed-in address matches no page', () => {
		it('should still be caught inside the signed-in layout', () => {
			// GIVEN the layout's own catch-all route
			// THEN it exists, so an unknown address is gated and shown inside the
			// app's chrome rather than falling through to the root
			expect(routeFiles(ROUTES_DIR)).toContain('_authed/$.tsx')
		})
	})
})
