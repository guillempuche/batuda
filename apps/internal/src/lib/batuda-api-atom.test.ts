import { describe, expect, it } from 'vitest'

import { buildDevApiOrigin } from '#/lib/batuda-api-atom'

// buildDevApiOrigin is the pure core of the cross-origin API host the data
// atoms fetch /v1/* from in dev. portless can't bind 443 without root, so it
// falls back to a port like :1355 and the page origin carries it — the derived
// API origin must carry the same port or every client-side data call lands on
// an unreachable :443 host.

describe('buildDevApiOrigin', () => {
	describe('on the main dev checkout', () => {
		it('should insert the api host and keep the port portless bound', () => {
			// GIVEN the page on batuda.localhost at portless's :1355
			// WHEN the API origin is derived
			// THEN it points at the api subdomain on the same port
			// [lib/batuda-api-atom.ts — apiHost + port kept]
			expect(buildDevApiOrigin('batuda.localhost', '1355', 'https:')).toBe(
				'https://api.batuda.localhost:1355',
			)
		})
	})

	describe('in a worktree', () => {
		it('should map the branch subdomain to its matching api host', () => {
			// GIVEN a worktree page host
			// WHEN derived
			// THEN api. is inserted before the marker and the port kept
			// [lib/batuda-api-atom.ts — apiHost replace]
			expect(
				buildDevApiOrigin('feature-x.batuda.localhost', '1355', 'https:'),
			).toBe('https://feature-x.api.batuda.localhost:1355')
		})

		it('should derive for a multi-label subdomain too', () => {
			// GIVEN a host with more than one label under the marker
			// WHEN derived
			// THEN api. is still inserted before the marker (label count agnostic,
			//   unlike the server-side single-label trust matcher)
			// [lib/batuda-api-atom.ts — apiHost replace]
			expect(buildDevApiOrigin('a.b.batuda.localhost', '1355', 'https:')).toBe(
				'https://a.b.api.batuda.localhost:1355',
			)
		})
	})

	describe('when portless is on the default 443', () => {
		it('should drop the port the browser omits from its origin', () => {
			// GIVEN portless bound 443 (an explicit :443, or no port at all)
			// WHEN derived
			// THEN no port suffix, matching the portless-on-443 browser origin
			// [lib/batuda-api-atom.ts — port dropped]
			expect(buildDevApiOrigin('batuda.localhost', '443', 'https:')).toBe(
				'https://api.batuda.localhost',
			)
			expect(buildDevApiOrigin('batuda.localhost', '', 'https:')).toBe(
				'https://api.batuda.localhost',
			)
		})
	})

	describe('when the page itself is served over http', () => {
		it('should honor the page scheme rather than pin https', () => {
			// GIVEN an http page (window.location.protocol is authoritative here,
			//   unlike the server which pins https because PORTLESS_URL lies)
			// WHEN derived
			// THEN the API origin uses the same scheme the page loaded with
			// [lib/batuda-api-atom.ts — protocol passthrough]
			expect(buildDevApiOrigin('batuda.localhost', '1355', 'http:')).toBe(
				'http://api.batuda.localhost:1355',
			)
		})
	})

	describe('off a dev host (production)', () => {
		it('should return null so VITE_SERVER_URL wins', () => {
			// GIVEN a production page host
			// WHEN derived
			// THEN null — the bundle's VITE_SERVER_URL is the API origin instead
			// [lib/batuda-api-atom.ts — label-boundary guard]
			expect(buildDevApiOrigin('app.batuda.co', '', 'https:')).toBeNull()
		})

		it('should reject a lookalike that only suffix-matches the marker', () => {
			// GIVEN hosts ending in the marker text but not on a label boundary
			// WHEN derived
			// THEN null — least trust: no self-derived origin off a bare endsWith
			// [lib/batuda-api-atom.ts — label-boundary guard]
			expect(
				buildDevApiOrigin('xbatuda.localhost', '1355', 'https:'),
			).toBeNull()
			expect(
				buildDevApiOrigin('batuda.localhost.evil.com', '', 'https:'),
			).toBeNull()
		})
	})
})
