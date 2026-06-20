import { describe, expect, it } from 'vitest'

import {
	buildInvitationCallbackURL,
	findPublicUrlNotAllowed,
	findWildcardOrigin,
	mergeWorktreeOrigin,
} from './env.js'

// Locks in the boot guard that refuses any ALLOWED_ORIGINS entry containing a
// `*`. Wildcards aren't a valid origin shape — a worktree's branch-prefixed
// origin is derived from PORTLESS_URL and merged in literally — so a stray
// `*.host` (dev or a production `*.example.com`) is a config mistake that must
// fail boot, not silently never match.

describe('findWildcardOrigin', () => {
	describe('with only literal origins', () => {
		it('should return null', () => {
			// GIVEN a list of literal origins
			// WHEN the validator runs
			// THEN no offender is reported
			// [lib/env.ts — no `*` found]
			expect(
				findWildcardOrigin([
					'https://batuda.localhost',
					'https://crm.example.com',
				]),
			).toBeNull()
		})

		it('should return null for an empty list', () => {
			// GIVEN no configured origins
			// WHEN the validator runs
			// THEN null (nothing to reject)
			// [lib/env.ts — empty loop]
			expect(findWildcardOrigin([])).toBeNull()
		})
	})

	describe('with a wildcard under .localhost', () => {
		it('should report it so boot fails', () => {
			// GIVEN a dev-style `*.batuda.localhost` wildcard
			// WHEN the validator runs
			// THEN it is reported — wildcards are rejected even under .localhost; the
			//   worktree origin is derived from PORTLESS_URL and merged in literally
			// [lib/env.ts — pattern.includes('*')]
			expect(
				findWildcardOrigin([
					'https://batuda.localhost',
					'https://*.batuda.localhost',
				]),
			).toBe('https://*.batuda.localhost')
		})
	})

	describe('with a wildcard under a routable apex', () => {
		it('should report the production-style pattern', () => {
			// GIVEN a `*.example.com` wildcard
			// WHEN the validator runs
			// THEN it is reported so a broad subdomain-trust hole never ships
			// [lib/env.ts — pattern.includes('*')]
			expect(
				findWildcardOrigin([
					'https://batuda.localhost',
					'https://*.example.com',
				]),
			).toBe('https://*.example.com')
		})
	})

	describe('with several wildcards', () => {
		it('should report the first one found', () => {
			// GIVEN more than one wildcard entry
			// WHEN the validator runs
			// THEN the first is returned (boot fails on it; order is the env order)
			// [lib/env.ts — returns on first match]
			expect(
				findWildcardOrigin([
					'https://*.batuda.localhost',
					'https://*.example.com',
				]),
			).toBe('https://*.batuda.localhost')
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

// APP_PUBLIC_URL must be one of ALLOWED_ORIGINS (matched exactly) or the server
// refuses to boot, so an invite can't point at a host the app doesn't trust. A
// portless-derived worktree origin passes because it was merged into the list
// literally — there is no wildcard widening.
describe('findPublicUrlNotAllowed', () => {
	describe('when the public URL is one of the allowed origins', () => {
		it('should return null', () => {
			// GIVEN APP_PUBLIC_URL listed literally in ALLOWED_ORIGINS
			// WHEN the validator runs
			// THEN it passes (null)
			// [lib/env.ts — exact-match member]
			expect(
				findPublicUrlNotAllowed('https://batuda.co', [
					'https://admin.batuda.co',
					'https://batuda.co',
				]),
			).toBeNull()
		})
	})

	describe('when the public URL is a derived worktree origin in the list', () => {
		it('should return null because it was merged in literally', () => {
			// GIVEN a derived worktree origin (with its port) listed literally — the
			//   shape mergeWorktreeOrigin produces in EnvVars
			// WHEN the validator runs
			// THEN it passes by exact match, not via any wildcard
			// [lib/env.ts — exact-match member]
			expect(
				findPublicUrlNotAllowed('https://feature-x.batuda.localhost:1355', [
					'https://feature-x.batuda.localhost:1355',
					'https://batuda.localhost',
				]),
			).toBeNull()
		})
	})

	describe('when the public URL is a subdomain that is not listed', () => {
		it('should return a message — no wildcard widens trust to it', () => {
			// GIVEN a subdomain of a listed host, but not itself listed
			// WHEN the validator runs
			// THEN it is rejected — only exact origins pass, no `*.host` widening
			// [lib/env.ts — non-membership branch]
			const message = findPublicUrlNotAllowed(
				'https://other.batuda.localhost',
				['https://batuda.localhost'],
			)
			expect(message).not.toBeNull()
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
					['https://batuda.localhost'],
					'https://batuda.localhost:1355',
				),
			).toEqual(['https://batuda.localhost:1355', 'https://batuda.localhost'])
		})

		it('should let the merged list pass the APP_PUBLIC_URL boot check', () => {
			// GIVEN APP_PUBLIC_URL is the derived ported origin (set the same way in
			//   EnvVars), absent from the static list
			// WHEN the merged list is fed to the boot check
			// THEN it passes — the merge is what keeps boot from failing on the port
			// [lib/env.ts — mergeWorktreeOrigin feeds findPublicUrlNotAllowed]
			const appPublicUrl = 'https://batuda.localhost:1355'
			const merged = mergeWorktreeOrigin(
				['https://batuda.localhost'],
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
					['https://batuda.localhost'],
					'https://batuda.localhost',
				),
			).toEqual(['https://batuda.localhost'])
		})
	})

	describe('when there is no worktree origin (production)', () => {
		it('should return the env list unchanged', () => {
			// GIVEN null (deriveWorktreeOrigins returns null off a batuda.localhost host)
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
