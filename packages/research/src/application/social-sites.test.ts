import { describe, expect, it } from 'vitest'

import { isSocialPlatformHost } from './social-sites'

describe('isSocialPlatformHost', () => {
	describe('when the host is a platform', () => {
		it('should recognise every platform on the list', () => {
			// GIVEN each host the list names
			// WHEN asked
			// THEN each is a platform. Asked one by one rather than in the round, so a
			// letter dropped from any single entry fails here instead of quietly
			// letting that platform's pages ship as websites
			for (const host of [
				'facebook.com',
				'instagram.com',
				'linkedin.com',
				'x.com',
				'twitter.com',
				'tiktok.com',
				'youtube.com',
				'youtu.be',
				'threads.net',
			]) {
				expect(isSocialPlatformHost(host)).toBe(true)
			}
		})

		it('should recognise a country or device subdomain', () => {
			// GIVEN the subdomains a platform serves its own countries and phones from
			// WHEN asked
			// THEN each is the same platform. A page is no more the company's own site
			// for having been reached through the Spanish or the mobile door
			expect(isSocialPlatformHost('es-la.facebook.com')).toBe(true)
			expect(isSocialPlatformHost('m.facebook.com')).toBe(true)
			expect(isSocialPlatformHost('fr.linkedin.com')).toBe(true)
			expect(isSocialPlatformHost('business.facebook.com')).toBe(true)
		})

		it('should read a host written in capitals', () => {
			// GIVEN the same host written the other way
			// WHEN asked
			// THEN still a platform: a domain means the same however it was typed
			expect(isSocialPlatformHost('FACEBOOK.COM')).toBe(true)
			expect(isSocialPlatformHost('Es-La.Facebook.Com')).toBe(true)
		})

		it('should read a host with space around it', () => {
			// GIVEN a host that arrived with whitespace on it
			// WHEN asked — THEN the space is not part of anybody's domain
			expect(isSocialPlatformHost(' facebook.com ')).toBe(true)
		})

		it('should read a host written with the dot a domain may end in', () => {
			// GIVEN the fully-spelled form of the same domain, which a browser fetches
			// exactly as it fetches the ordinary one
			// WHEN asked
			// THEN still a platform. Missing this is the one way left to hand back a
			// Facebook page and have it kept — the address opens perfectly well
			expect(isSocialPlatformHost('facebook.com.')).toBe(true)
			expect(isSocialPlatformHost('es-la.facebook.com.')).toBe(true)
		})
	})

	describe('when the host only resembles a platform', () => {
		it('should refuse a host that merely ends in the same letters', () => {
			// GIVEN a domain whose ending reads like a platform's without the dot that
			// would make it one
			// WHEN asked
			// THEN it is somebody else's ordinary site. Whoever registered
			// "notfacebook.com" owns it outright, and blanking their website would
			// cost a real company its own address
			expect(isSocialPlatformHost('notfacebook.com')).toBe(false)
			expect(isSocialPlatformHost('myyoutu.be')).toBe(false)
		})

		it('should refuse a host that starts with a platform name', () => {
			// GIVEN the agencies named after the platform they work on, which are
			// ordinary companies with ordinary domains
			// WHEN asked — THEN their own domains are their own
			expect(isSocialPlatformHost('facebook-ads-agency.com')).toBe(false)
			expect(isSocialPlatformHost('instagram-marketing.es')).toBe(false)
		})

		it('should refuse a host carrying a platform name in the middle', () => {
			// GIVEN a domain that puts a platform's whole name where a subdomain would
			// read, on a registrable domain of its own
			// WHEN asked
			// THEN it belongs to whoever registered "evil.example", not to the platform
			// its earlier labels spell
			expect(isSocialPlatformHost('facebook.com.evil.example')).toBe(false)
		})

		it('should refuse an ordinary company host', () => {
			// GIVEN the sites this check exists to leave standing
			// WHEN asked — THEN nothing here is a platform
			expect(isSocialPlatformHost('acme.com')).toBe(false)
			expect(isSocialPlatformHost('xpo.com')).toBe(false)
			expect(isSocialPlatformHost('fusteriamiquel.cat')).toBe(false)
		})
	})

	describe('when there is no host to read', () => {
		it('should refuse an empty host', () => {
			// GIVEN nothing at all
			// WHEN asked — THEN nothing is a platform, which is what a caller with no
			// address to read needs to hear
			expect(isSocialPlatformHost('')).toBe(false)
			expect(isSocialPlatformHost('   ')).toBe(false)
		})

		it('should refuse a bare word that is not a domain', () => {
			// GIVEN an internal page id rather than a host
			// WHEN asked — THEN it names no platform
			expect(isSocialPlatformHost('src_abc123')).toBe(false)
		})
	})
})
