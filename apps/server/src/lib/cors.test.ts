import { describe, expect, it } from 'vitest'

import { matchOrigin } from './cors.js'

// Locks in the exact-origin matching ALLOWED_ORIGINS uses (literal origins only,
// no wildcards). A dev worktree's branch-prefixed origin is derived from
// PORTLESS_URL and merged into the list, so CORS and the boot check judge every
// origin the same way — by exact equality, including the port.

describe('matchOrigin', () => {
	describe('with no origin (same-origin request)', () => {
		it('should return false instead of throwing', () => {
			// GIVEN no Origin header (same-origin request from the API to itself)
			// WHEN the matcher runs
			// THEN it returns false — the middleware only enforces CORS on
			//   cross-origin calls, so the request still goes through
			// [lib/origin-match.ts — undefined-origin guard]
			expect(matchOrigin(undefined, 'https://batuda.localhost')).toBe(false)
		})
	})

	describe('with a matching origin', () => {
		it('should match the exact origin', () => {
			// GIVEN a pattern equal to the candidate origin
			// WHEN the matcher runs
			// THEN it returns true
			// [lib/origin-match.ts — origin === pattern]
			expect(
				matchOrigin('https://batuda.localhost', 'https://batuda.localhost'),
			).toBe(true)
		})
	})

	describe('with a non-matching origin', () => {
		it('should reject a subdomain of the pattern host', () => {
			// GIVEN a subdomain of the pattern's host
			// WHEN the matcher runs
			// THEN it returns false — without wildcards a subdomain is trusted only
			//   when listed (or derived + merged) literally
			// [lib/origin-match.ts — exact match, no subdomain widening]
			expect(
				matchOrigin(
					'https://other.batuda.localhost',
					'https://batuda.localhost',
				),
			).toBe(false)
		})

		it('should reject a port mismatch', () => {
			// GIVEN the same host on a different port
			// WHEN the matcher runs
			// THEN it returns false — an origin includes its port
			// [lib/origin-match.ts — exact match includes the port]
			expect(
				matchOrigin(
					'https://batuda.localhost:1355',
					'https://batuda.localhost',
				),
			).toBe(false)
		})
	})
})
