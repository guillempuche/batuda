import { describe, expect, it } from 'vitest'

import { cookieDomainFromBaseURL } from './build-better-auth-config.js'

// Pins the cookie-domain derivation rule. Better-Auth uses the returned
// string as the Domain attribute on its session cookie; getting it
// wrong means the cookie set on the API host is invisible to the app
// host (and vice versa). Two scenarios matter here:
//
//   1. Prod: `api.batuda.co` and `batuda.co` must share the cookie.
//   2. Dev worktree: `feature-x.api.batuda.localhost` and
//      `feature-x.batuda.localhost` must share the cookie.
//
// The .localhost branch collapses to the last two labels so any
// number of leading labels still resolves to the apex (`batuda.localhost`),
// matching how portless prefixes worktree subdomains.

describe('cookieDomainFromBaseURL', () => {
	describe('with a production hostname', () => {
		it('should strip the first label of a 3-label host', () => {
			// GIVEN `https://api.batuda.co`
			// WHEN the derivation runs
			// THEN it returns `batuda.co` so app + api share the cookie
			// [build-better-auth-config.ts — `labels.slice(1)` branch]
			expect(cookieDomainFromBaseURL('https://api.batuda.co')).toBe('batuda.co')
		})

		it('should preserve a deeper-tier prefix above the second-level domain', () => {
			// GIVEN `https://api.eu-west.batuda.co`
			// WHEN the derivation runs
			// THEN it returns `eu-west.batuda.co` (strip exactly one label)
			expect(cookieDomainFromBaseURL('https://api.eu-west.batuda.co')).toBe(
				'eu-west.batuda.co',
			)
		})

		it('should return undefined for a 2-label host', () => {
			// GIVEN `https://batuda.co` (no API subdomain)
			// WHEN the derivation runs
			// THEN it returns undefined so Better-Auth omits the Domain attribute
			//   and the cookie stays host-only
			// [build-better-auth-config.ts — `length >= 3` guard]
			expect(cookieDomainFromBaseURL('https://batuda.co')).toBeUndefined()
		})
	})

	describe('with a .localhost hostname', () => {
		it('should collapse a 3-label dev host to the apex', () => {
			// GIVEN `https://api.batuda.localhost`
			// WHEN the derivation runs
			// THEN the cookie is scoped to `batuda.localhost` so the app at
			//   `batuda.localhost` sees the cookie set on the API host
			// [build-better-auth-config.ts — `isLocalhost` branch]
			expect(cookieDomainFromBaseURL('https://api.batuda.localhost')).toBe(
				'batuda.localhost',
			)
		})

		it('should collapse a 4-label worktree host to the apex', () => {
			// GIVEN `https://feature-x.api.batuda.localhost`
			// WHEN the derivation runs
			// THEN the cookie still resolves to `batuda.localhost` so it spans
			//   both the worktree app at `feature-x.batuda.localhost` and the
			//   worktree API at `feature-x.api.batuda.localhost`
			// [build-better-auth-config.ts — `slice(-2)` branch]
			expect(
				cookieDomainFromBaseURL('https://feature-x.api.batuda.localhost'),
			).toBe('batuda.localhost')
		})
	})

	describe('with invalid input', () => {
		it('should return undefined for missing baseURL', () => {
			// GIVEN no baseURL
			// THEN no domain is derived
			expect(cookieDomainFromBaseURL(undefined)).toBeUndefined()
		})

		it('should return undefined for malformed URLs', () => {
			// GIVEN a non-URL string
			// THEN the catch branch returns undefined instead of throwing
			expect(cookieDomainFromBaseURL('not a url')).toBeUndefined()
		})
	})
})
