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

		it('should pin https + drop the port for the real portless format', () => {
			// GIVEN portless's actual PORTLESS_URL (http scheme, :443 port)
			// WHEN origins are derived
			// THEN the scheme is pinned to https and the port dropped, so they match
			//   the `https://*.batuda.localhost` CORS wildcard the server trusts
			// [lib/portless-origins.ts — https pin]
			expect(
				deriveWorktreeOrigins('http://feature-x.api.batuda.localhost:443'),
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
			// [lib/portless-origins.ts — endsWith(DEV_MARKER) guard]
			expect(deriveWorktreeOrigins('https://api.batuda.co')).toBeNull()
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
