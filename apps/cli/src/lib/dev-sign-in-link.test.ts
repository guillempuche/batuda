import { describe, expect, it } from 'vitest'

import { onProxyRoute } from './dev-sign-in-link'

const MINTED =
	'https://api.batuda.localhost/auth/magic-link/verify?token=ABC123&callbackURL=%2F'

const route = (prefix: string, port: string) => ({ prefix, port })

describe('onProxyRoute', () => {
	describe('when the proxy answers somewhere the link does not name', () => {
		it('should move the link onto that host and port', () => {
			// GIVEN a link minted from settings that name neither
			// WHEN the proxy's own host prefix and port are applied
			const link = onProxyRoute(MINTED, route('onboard-org-fixes', '1355'))

			// THEN the link points at the server that holds the token
			expect(link).toBe(
				'https://onboard-org-fixes.api.batuda.localhost:1355/auth/magic-link/verify?token=ABC123&callbackURL=%2F',
			)
		})

		it('should leave the token and callback untouched', () => {
			// GIVEN a link whose callback is percent-encoded
			// WHEN it is moved onto the proxy's route
			const link = onProxyRoute(MINTED, route('wt', '1355'))

			// THEN both survive verbatim — re-encoding either would break sign-in
			expect(link).toContain('token=ABC123')
			expect(link).toContain('callbackURL=%2F')
		})

		it('should rewrite a bare localhost host too', () => {
			// GIVEN an address with no dotted host at all
			// WHEN the route is applied
			// THEN it is still served by the proxy, so it is still rewritten
			expect(onProxyRoute('https://localhost/auth', route('wt', '1355'))).toBe(
				'https://wt.localhost:1355/auth',
			)
		})
	})

	describe('when the link already names part of the route', () => {
		it('should not stack the prefix on a second time', () => {
			// GIVEN a link already on the worktree's host
			const url = 'https://wt.api.batuda.localhost/auth'

			// WHEN the same prefix is applied
			// THEN the host is left as it is
			expect(onProxyRoute(url, route('wt', ''))).toBe(url)
		})

		it('should keep the port the link already carries', () => {
			// GIVEN a link that names its own port
			const url = 'https://api.batuda.localhost:8443/auth'

			// WHEN a different port is read from the machine
			// THEN what the link names wins
			expect(onProxyRoute(url, route('', '1355'))).toBe(url)
		})
	})

	describe('when there is nothing to apply', () => {
		it('should return the link unchanged', () => {
			// GIVEN no worktree prefix and a proxy on the standard port
			// WHEN the empty route is applied
			// THEN the link is exactly as minted
			expect(onProxyRoute(MINTED, route('', ''))).toBe(MINTED)
		})
	})

	describe('when the link is not for this machine', () => {
		// A deployment's link has to be printed exactly as minted, and a made-up
		// host would resolve nowhere at all.
		it.each([
			['production', 'https://api.batuda.co/auth/magic-link/verify?token=A'],
			['a lookalike host', 'https://api.batuda.localhost.evil.com/auth'],
			['not a URL', 'not-a-url'],
			['empty', ''],
		])('should leave %s untouched', (_label, url) => {
			// GIVEN an address the local proxy does not serve
			// WHEN a full route is applied
			// THEN the link comes back exactly as it went in
			expect(onProxyRoute(url, route('wt', '1355'))).toBe(url)
		})
	})
})
