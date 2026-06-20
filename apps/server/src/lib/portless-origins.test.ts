import { describe, expect, it } from 'vitest'

import { deriveWorktreeOrigins } from './portless-origins.js'

// portless injects PORTLESS_URL as the server's own host. In a worktree that is
// `<branch>.api.batuda.localhost`; deriving the paired app origin lets the server
// mint links + cookies for the worktree instead of the main checkout. Off the
// `*.batuda.localhost` marker (production) it returns null so the static env wins.

describe('deriveWorktreeOrigins', () => {
	describe('when PORTLESS_URL is a worktree api host', () => {
		it('should derive the worktree api + app origins', () => {
			// GIVEN a branch-prefixed portless api host
			// WHEN origins are derived
			// THEN api keeps the host and app drops the `api.` label
			// [lib/portless-origins.ts — appHost replace]
			expect(
				deriveWorktreeOrigins('https://feature-x.api.batuda.localhost'),
			).toEqual({
				apiOrigin: 'https://feature-x.api.batuda.localhost',
				appOrigin: 'https://feature-x.batuda.localhost',
			})
		})

		it('should keep the port portless assigned so it matches the browser origin', () => {
			// GIVEN portless's real PORTLESS_URL — https with the non-443 port it
			//   grabbed because it couldn't bind 443 (formatUrl renders https://host:1355)
			// WHEN origins are derived
			// THEN the :1355 port is preserved, so the derived app origin equals the
			//   browser's Origin header and Better-Auth + CORS trust the sign-in
			// [lib/portless-origins.ts — portSuffix kept]
			expect(
				deriveWorktreeOrigins('https://feature-x.api.batuda.localhost:1355'),
			).toEqual({
				apiOrigin: 'https://feature-x.api.batuda.localhost:1355',
				appOrigin: 'https://feature-x.batuda.localhost:1355',
			})
		})

		it('should pin https even when PORTLESS_URL reports an http scheme', () => {
			// GIVEN an http-scheme PORTLESS_URL (older/non-TLS portless reporting)
			// WHEN origins are derived
			// THEN the scheme is pinned to https (the browser always loads these
			//   hosts over TLS) while the port is still kept
			// [lib/portless-origins.ts — https pin]
			expect(
				deriveWorktreeOrigins('http://feature-x.api.batuda.localhost:1355'),
			).toEqual({
				apiOrigin: 'https://feature-x.api.batuda.localhost:1355',
				appOrigin: 'https://feature-x.batuda.localhost:1355',
			})
		})

		it('should drop the default :443 the browser omits from its origin', () => {
			// GIVEN portless bound the privileged 443 port (an explicit :443)
			// WHEN origins are derived
			// THEN the port is dropped, matching the portless-on-443 browser origin
			// [lib/portless-origins.ts — :443 dropped]
			expect(
				deriveWorktreeOrigins('https://feature-x.api.batuda.localhost:443'),
			).toEqual({
				apiOrigin: 'https://feature-x.api.batuda.localhost',
				appOrigin: 'https://feature-x.batuda.localhost',
			})
		})
	})

	describe('when PORTLESS_URL is the main checkout api host', () => {
		it('should derive the bare app origin', () => {
			// GIVEN the unprefixed api host
			// WHEN origins are derived
			// THEN the app origin collapses to the bare marker
			// [lib/portless-origins.ts — api.<marker> → <marker>]
			expect(deriveWorktreeOrigins('https://api.batuda.localhost')).toEqual({
				apiOrigin: 'https://api.batuda.localhost',
				appOrigin: 'https://batuda.localhost',
			})
		})
	})

	describe('when PORTLESS_URL is not a batuda.localhost host', () => {
		it('should return null so production keeps its env origins', () => {
			// GIVEN a production-style host
			// WHEN origins are derived
			// THEN null — the caller falls back to the configured env values
			// [lib/portless-origins.ts — label-boundary marker guard]
			expect(deriveWorktreeOrigins('https://api.batuda.co')).toBeNull()
		})

		it('should reject a lookalike host that only suffix-matches the marker', () => {
			// GIVEN a host that ends in the marker text but not on a label boundary
			// WHEN origins are derived
			// THEN null — least trust: `xbatuda.localhost` must not self-derive a
			//   trusted origin off a bare endsWith() check
			// [lib/portless-origins.ts — apiHost !== marker && endsWith('.' + marker)]
			expect(deriveWorktreeOrigins('https://xbatuda.localhost')).toBeNull()
			expect(
				deriveWorktreeOrigins('https://api.batuda.localhost.evil.com'),
			).toBeNull()
		})
	})

	describe('when PORTLESS_URL is empty, undefined, or invalid', () => {
		it('should return null for an empty string', () => {
			// GIVEN no PORTLESS_URL (portless not in the loop)
			// WHEN origins are derived
			// THEN null
			// [lib/portless-origins.ts — falsy guard]
			expect(deriveWorktreeOrigins('')).toBeNull()
		})

		it('should return null for undefined', () => {
			// GIVEN undefined
			// WHEN origins are derived
			// THEN null
			// [lib/portless-origins.ts — falsy guard]
			expect(deriveWorktreeOrigins(undefined)).toBeNull()
		})

		it('should return null for an unparseable URL rather than throwing', () => {
			// GIVEN a malformed value
			// WHEN origins are derived
			// THEN null
			// [lib/portless-origins.ts — try/catch]
			expect(deriveWorktreeOrigins('not a url')).toBeNull()
		})
	})
})
