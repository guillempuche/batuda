import { describe, expect, it } from 'vitest'

import { matchOrigin } from './cors.js'

// Locks in the wildcard-subdomain rule used by ALLOWED_ORIGINS so the
// dev-time worktree workflow (portless prepends a branch subdomain to
// the configured route) keeps working without per-branch env tweaks,
// and so a typo in the matcher can't accidentally widen what passes
// CORS in production.

describe('matchOrigin', () => {
	describe('with no origin (same-origin request)', () => {
		it('should return false instead of throwing', () => {
			// GIVEN no Origin header (same-origin request from the API to itself)
			// WHEN the matcher runs
			// THEN it returns false — the middleware only enforces CORS on
			//   cross-origin calls, so the request still goes through
			// [lib/cors.ts:28 — `typeof origin !== 'string'` guard]
			expect(matchOrigin(undefined, 'https://batuda.localhost')).toBe(false)
		})
	})

	describe('with a literal origin pattern', () => {
		it('should match the exact origin', () => {
			// GIVEN a literal pattern equal to the candidate origin
			// WHEN the matcher runs
			// THEN it returns true
			// [lib/cors.ts:25 — `origin === pattern` short-circuit]
			expect(
				matchOrigin('https://batuda.localhost', 'https://batuda.localhost'),
			).toBe(true)
		})

		it('should reject any other origin', () => {
			// GIVEN a literal pattern
			// WHEN a non-equal origin is checked
			// THEN it returns false
			expect(
				matchOrigin(
					'https://other.batuda.localhost',
					'https://batuda.localhost',
				),
			).toBe(false)
		})
	})

	describe('with a wildcard subdomain pattern', () => {
		const PATTERN = 'https://*.batuda.localhost'

		it('should match a single-label subdomain under the suffix', () => {
			// GIVEN `https://*.batuda.localhost`
			// WHEN a worktree route like `https://feature-x.batuda.localhost` checks
			// THEN it is allowed
			// [lib/cors.ts:34 — single-label wildcard branch]
			expect(matchOrigin('https://feature-x.batuda.localhost', PATTERN)).toBe(
				true,
			)
		})

		it('should reject the bare suffix host without a subdomain', () => {
			// GIVEN `https://*.batuda.localhost`
			// WHEN the bare suffix host is checked
			// THEN it is not matched (literal listing covers that case)
			// [lib/cors.ts:39 — empty-sub guard]
			expect(matchOrigin('https://batuda.localhost', PATTERN)).toBe(false)
		})

		it('should reject multi-label subdomains', () => {
			// GIVEN `https://*.batuda.localhost`
			// WHEN a deeper subdomain like `a.b.batuda.localhost` checks
			// THEN it is rejected so a leaked DNS record can't satisfy the wildcard
			// [lib/cors.ts:43 — single-label invariant]
			expect(matchOrigin('https://a.b.batuda.localhost', PATTERN)).toBe(false)
		})

		it('should reject mismatched protocols', () => {
			// GIVEN `https://*.batuda.localhost`
			// WHEN an http origin checks
			// THEN it is rejected
			// [lib/cors.ts:35 — protocol prefix guard]
			expect(matchOrigin('http://x.batuda.localhost', PATTERN)).toBe(false)
		})

		it('should reject an attacker-controlled suffix collision', () => {
			// GIVEN `https://*.batuda.localhost`
			// WHEN an origin uses the suffix as a *prefix* of its own host
			//   (e.g. `evil.batuda.localhost.attacker.com`)
			// THEN it is rejected — wildcard endsWith uses a literal `.suffix`
			// [lib/cors.ts:38 — `.${suffix}` boundary]
			expect(
				matchOrigin('https://evil.batuda.localhost.attacker.com', PATTERN),
			).toBe(false)
		})
	})
})
