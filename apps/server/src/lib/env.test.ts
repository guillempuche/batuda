import { describe, expect, it } from 'vitest'

import { findUnsafeWildcardOrigin } from './env.js'

// Locks in the safety guard that refuses to boot when ALLOWED_ORIGINS
// includes a wildcard pattern whose suffix is *not* `.localhost`. Without
// this rule, a typo or copy-paste error in production env could grant
// CORS + Better-Auth trust to every subdomain of an externally-resolvable
// apex (e.g. `https://*.example.com`).

describe('findUnsafeWildcardOrigin', () => {
	describe('with no wildcard patterns', () => {
		it('should return null', () => {
			// GIVEN a list of literal origins
			// WHEN the validator runs
			// THEN no offender is reported
			// [lib/env.ts — first short-circuit branch]
			expect(
				findUnsafeWildcardOrigin([
					'https://batuda.localhost',
					'https://crm.example.com',
				]),
			).toBeNull()
		})
	})

	describe('with a wildcard under .localhost', () => {
		it('should accept worktree-friendly localhost wildcards', () => {
			// GIVEN a wildcard pattern under .localhost
			// WHEN the validator runs
			// THEN no offender is reported (dev worktree subdomains are safe
			//   because .localhost is not externally resolvable)
			// [lib/env.ts — endsWith('.localhost') branch]
			expect(
				findUnsafeWildcardOrigin([
					'https://batuda.localhost',
					'https://*.batuda.localhost',
				]),
			).toBeNull()
		})

		it('should accept the bare localhost suffix', () => {
			// GIVEN `https://*.localhost`
			// WHEN the validator runs
			// THEN it is accepted
			// [lib/env.ts — `suffix === 'localhost'` short-circuit]
			expect(findUnsafeWildcardOrigin(['https://*.localhost'])).toBeNull()
		})
	})

	describe('with a wildcard outside .localhost', () => {
		it('should report the offending production-style pattern', () => {
			// GIVEN a wildcard pattern under a routable apex
			// WHEN the validator runs
			// THEN it returns the offending pattern so boot fails loudly
			// [lib/env.ts — `return pattern` branch]
			expect(
				findUnsafeWildcardOrigin([
					'https://batuda.localhost',
					'https://*.example.com',
				]),
			).toBe('https://*.example.com')
		})

		it('should reject sneaky `.localhost.attacker.com` suffixes', () => {
			// GIVEN a wildcard whose suffix only superficially mentions localhost
			// WHEN the validator runs
			// THEN it is rejected because the suffix doesn't end in `.localhost`
			// [lib/env.ts — endsWith vs contains]
			expect(
				findUnsafeWildcardOrigin(['https://*.localhost.attacker.com']),
			).toBe('https://*.localhost.attacker.com')
		})
	})
})
