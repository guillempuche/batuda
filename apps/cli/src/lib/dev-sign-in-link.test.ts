import { describe, expect, it } from 'vitest'

import { onProxyOrigin, serviceNameFor } from './dev-sign-in-link'

const MINTED =
	'https://api.batuda.localhost/auth/magic-link/verify?token=ABC123&callbackURL=%2F'

describe('serviceNameFor', () => {
	describe('when the proxy serves the host', () => {
		it.each([
			['api.batuda.localhost', 'api.batuda'],
			// A worktree is served under a host of its own, and the whole thing is
			// still one name as far as the proxy is concerned.
			[
				'onboard-org-fixes.api.batuda.localhost',
				'onboard-org-fixes.api.batuda',
			],
		])('should read %s as %s', (hostname, expected) => {
			// GIVEN a host the local proxy serves
			// WHEN its service name is read
			// THEN it is the host with the local suffix taken off
			expect(serviceNameFor(hostname)).toBe(expected)
		})
	})

	describe('when the proxy serves no such host', () => {
		// Anything here must leave the link alone, so a deployment's link is
		// printed exactly as minted and a lookalike host is never trusted.
		it.each([
			['a deployment', 'api.batuda.co'],
			['a lookalike host', 'api.batuda.localhost.evil.com'],
			['a bare localhost with no name in front', 'localhost'],
			['nothing at all', ''],
		])('should read %s as no service', (_label, hostname) => {
			// GIVEN a host that is not a named local service
			// WHEN its service name is read
			// THEN there is none
			expect(serviceNameFor(hostname)).toBeNull()
		})
	})
})

describe('onProxyOrigin', () => {
	describe('when the proxy answers on a different address', () => {
		it('should move the link there', () => {
			// GIVEN a link minted against the plain host
			// WHEN it is moved onto the address the proxy reported
			const link = onProxyOrigin(
				MINTED,
				'https://onboard-org-fixes.api.batuda.localhost:1355',
			)

			// THEN it points at the server that holds the token
			expect(link).toBe(
				'https://onboard-org-fixes.api.batuda.localhost:1355/auth/magic-link/verify?token=ABC123&callbackURL=%2F',
			)
		})

		it('should keep the token and callback exactly', () => {
			// GIVEN a link whose callback is percent-encoded
			// WHEN it is moved onto another address
			const link = onProxyOrigin(MINTED, 'https://wt.api.batuda.localhost:1355')

			// THEN both survive verbatim — re-encoding either would break sign-in
			expect(link).toContain('token=ABC123')
			expect(link).toContain('callbackURL=%2F')
		})

		it('should take the port from the address, including dropping one', () => {
			// GIVEN a link that already names a port
			const url = 'https://api.batuda.localhost:8443/auth'

			// WHEN the proxy reports it holds the standard port instead
			// THEN the link follows the proxy, since that is what is listening
			expect(onProxyOrigin(url, 'https://api.batuda.localhost')).toBe(
				'https://api.batuda.localhost/auth',
			)
		})
	})

	describe('when either side cannot be read', () => {
		it.each([
			['the link is not a URL', 'not-a-url', 'https://x.localhost:1355'],
			['the link is empty', '', 'https://x.localhost:1355'],
			['the address is not a URL', MINTED, 'nonsense'],
			['the address is empty', MINTED, ''],
		])('should return the link unchanged when %s', (_label, url, origin) => {
			// GIVEN text that cannot be parsed on one side or the other
			// WHEN the move is attempted
			// THEN the link comes back untouched rather than throwing mid-command
			expect(onProxyOrigin(url, origin)).toBe(url)
		})
	})
})
