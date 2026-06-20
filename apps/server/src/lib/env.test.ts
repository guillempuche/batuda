import { describe, expect, it } from 'vitest'

import {
	buildInvitationCallbackURL,
	findPublicUrlNotAllowed,
	findUnsafeWildcardOrigin,
	mergeWorktreeOrigin,
} from './env.js'

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

// The invitation callback URL is built from APP_PUBLIC_URL, not
// ALLOWED_ORIGINS[0] — so reordering the trusted-origins list can't silently
// retarget invite links. These lock the host the link points at.
describe('buildInvitationCallbackURL', () => {
	describe('with a public URL and an invitation id', () => {
		it('should build an absolute accept-invitation URL', () => {
			// GIVEN the canonical app origin and an invitation id
			// WHEN the callback URL is built
			// THEN it is <origin>/accept-invitation/<id>
			// [lib/env.ts — buildInvitationCallbackURL]
			expect(buildInvitationCallbackURL('https://batuda.co', 'inv-1')).toBe(
				'https://batuda.co/accept-invitation/inv-1',
			)
		})

		it('should trim a trailing slash on the origin', () => {
			// GIVEN a public URL with a trailing slash
			// WHEN the callback URL is built
			// THEN the slash is collapsed so the path isn't doubled
			// [lib/env.ts — replace(/\/$/, '')]
			expect(buildInvitationCallbackURL('https://batuda.co/', 'inv-2')).toBe(
				'https://batuda.co/accept-invitation/inv-2',
			)
		})

		it('should target the given origin regardless of any origins order', () => {
			// GIVEN the builder takes the origin directly (not ALLOWED_ORIGINS[0])
			// WHEN called with a second-listed product origin
			// THEN the link targets exactly that origin — reordering can't move it
			// [lib/env.ts — origin is a parameter, not positional]
			expect(buildInvitationCallbackURL('https://app.batuda.co', 'inv-3')).toBe(
				'https://app.batuda.co/accept-invitation/inv-3',
			)
		})
	})
})

// APP_PUBLIC_URL must be trusted by ALLOWED_ORIGINS (literal or wildcard) or the
// server refuses to boot, so an invite can't point at a host the app doesn't
// actually trust. Wildcard matching lets a portless-derived worktree origin pass.
describe('findPublicUrlNotAllowed', () => {
	describe('when the public URL is one of the allowed origins', () => {
		it('should return null', () => {
			// GIVEN APP_PUBLIC_URL listed literally in ALLOWED_ORIGINS
			// WHEN the validator runs
			// THEN it passes (null)
			// [lib/env.ts — matchOrigin literal branch]
			expect(
				findPublicUrlNotAllowed('https://batuda.co', [
					'https://admin.batuda.co',
					'https://batuda.co',
				]),
			).toBeNull()
		})
	})

	describe('when the public URL matches an allowed wildcard origin', () => {
		it('should return null', () => {
			// GIVEN a derived worktree origin and a `*.batuda.localhost` wildcard
			// WHEN the validator runs
			// THEN the wildcard accepts it (the literal isn't listed)
			// [lib/env.ts — matchOrigin wildcard branch]
			expect(
				findPublicUrlNotAllowed('https://feature-x.batuda.localhost', [
					'https://batuda.localhost',
					'https://*.batuda.localhost',
				]),
			).toBeNull()
		})
	})

	describe('when the public URL is not an allowed origin', () => {
		it('should return a message so boot fails', () => {
			// GIVEN APP_PUBLIC_URL absent from ALLOWED_ORIGINS
			// WHEN the validator runs
			// THEN it returns a non-null message that EnvVars turns into a boot
			//   ConfigError
			// [lib/env.ts — non-membership branch]
			const message = findPublicUrlNotAllowed('https://evil.example', [
				'https://batuda.co',
			])
			expect(message).not.toBeNull()
			expect(message).toContain('APP_PUBLIC_URL')
		})
	})
})

// portless can't bind 443 without privileges, so it falls back to a port like
// :1355 and the browser's Origin becomes `https://batuda.localhost:1355`. That
// port is absent from the static ALLOWED_ORIGINS, so the derived app origin must
// be folded in or every sign-in 403s — the out-of-the-box dev failure this guards.
describe('mergeWorktreeOrigin', () => {
	describe('when a worktree app origin is given', () => {
		it('should prepend the derived port-carrying origin to the trusted list', () => {
			// GIVEN the static origins (no port) and the portless-derived origin
			// WHEN they are merged
			// THEN the ported origin leads the list so CORS + Better-Auth trust it
			// [lib/env.ts — prepend branch]
			expect(
				mergeWorktreeOrigin(
					['https://batuda.localhost', 'https://*.batuda.localhost'],
					'https://batuda.localhost:1355',
				),
			).toEqual([
				'https://batuda.localhost:1355',
				'https://batuda.localhost',
				'https://*.batuda.localhost',
			])
		})

		it('should let the merged list pass the APP_PUBLIC_URL boot check', () => {
			// GIVEN APP_PUBLIC_URL is the derived ported origin (set the same way in
			//   EnvVars), absent from the static list
			// WHEN the merged list is fed to the boot check
			// THEN it passes — the merge is what keeps boot from failing on the port
			// [lib/env.ts — mergeWorktreeOrigin feeds findPublicUrlNotAllowed]
			const appPublicUrl = 'https://batuda.localhost:1355'
			const merged = mergeWorktreeOrigin(
				['https://batuda.localhost', 'https://*.batuda.localhost'],
				appPublicUrl,
			)
			expect(findPublicUrlNotAllowed(appPublicUrl, merged)).toBeNull()
		})

		it('should not duplicate an origin already present in the list', () => {
			// GIVEN the derived origin already listed literally (portless on 443, no
			//   port, collapses onto the static entry)
			// WHEN they are merged
			// THEN the list is returned unchanged — no duplicate trusted origin
			// [lib/env.ts — includes() short-circuit]
			expect(
				mergeWorktreeOrigin(
					['https://batuda.localhost', 'https://*.batuda.localhost'],
					'https://batuda.localhost',
				),
			).toEqual(['https://batuda.localhost', 'https://*.batuda.localhost'])
		})
	})

	describe('when there is no worktree origin (production)', () => {
		it('should return the env list unchanged', () => {
			// GIVEN null (deriveWorktreeOrigins returns null off *.batuda.localhost)
			// WHEN merged
			// THEN the explicitly-configured production origins win untouched
			// [lib/env.ts — null short-circuit]
			expect(
				mergeWorktreeOrigin(
					['https://batuda.co', 'https://engranatge.com'],
					null,
				),
			).toEqual(['https://batuda.co', 'https://engranatge.com'])
		})
	})
})
