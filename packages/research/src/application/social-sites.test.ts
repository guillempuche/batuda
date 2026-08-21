import { describe, expect, it } from 'vitest'

import { isSocialPlatformHost, socialProfileOf } from './social-sites'

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

describe('socialProfileOf', () => {
	describe('when the address is a company page on a platform', () => {
		it('should read a page at the top level of the platform', () => {
			// GIVEN the page a small firm opened in its own name
			// WHEN read
			// THEN it is that company's page on Facebook, under the name a channel is
			// stored by
			expect(socialProfileOf('https://www.facebook.com/LIPOTECH.SARL')).toEqual(
				{
					kind: 'facebook',
					value: 'https://facebook.com/LIPOTECH.SARL',
				},
			)
			expect(
				socialProfileOf('https://www.instagram.com/acmelogistics/'),
			).toEqual({
				kind: 'instagram',
				value: 'https://instagram.com/acmelogistics',
			})
		})

		it('should read the two names one platform answers to as one channel', () => {
			// GIVEN the same account reached by the platform's old name and its new one
			// WHEN each is read
			// THEN both are the same kind of channel, or one company would hold two
			// that are the same thing
			expect(socialProfileOf('https://x.com/acme')?.kind).toBe('x')
			expect(socialProfileOf('https://twitter.com/acme')?.kind).toBe('x')
		})

		it("should read a company page filed under a word of the platform's own", () => {
			// GIVEN LinkedIn, where a company's page sits under "company" and never at
			// the top level
			// WHEN read — THEN it is the company's page
			expect(
				socialProfileOf('https://www.linkedin.com/company/acme-logistics'),
			).toEqual({
				kind: 'linkedin',
				value: 'https://linkedin.com/company/acme-logistics',
			})
			expect(
				socialProfileOf('https://fr.linkedin.com/company/acme/')?.kind,
			).toBe('linkedin')
		})

		it('should read an account written with the mark its platform uses', () => {
			// GIVEN the platforms that write an account as "@name"
			// WHEN read — THEN the mark is what says it is an account
			expect(socialProfileOf('https://www.tiktok.com/@acme')?.kind).toBe(
				'tiktok',
			)
			expect(socialProfileOf('https://www.threads.net/@acme')?.kind).toBe(
				'threads',
			)
			expect(socialProfileOf('https://www.youtube.com/@acme')?.kind).toBe(
				'youtube',
			)
		})

		it('should read the older ways a channel is written', () => {
			// GIVEN the three forms YouTube used before the "@name" one
			// WHEN read — THEN each is still that company's channel
			for (const url of [
				'https://www.youtube.com/channel/UC123',
				'https://www.youtube.com/c/acme',
				'https://www.youtube.com/user/acme',
			]) {
				expect(socialProfileOf(url)?.kind).toBe('youtube')
			}
		})

		it('should give one page one address however it was written', () => {
			// GIVEN the spellings one page arrives in across rounds and sources — with
			// and without the www, with and without a trailing slash, and carrying the
			// parameters a shared link picks up
			const spellings = [
				'https://www.facebook.com/acme',
				'https://facebook.com/acme',
				'https://facebook.com/acme/',
				'https://www.facebook.com/acme?ref=share&fbclid=abc',
				'https://m.facebook.com/acme',
			]

			// WHEN each is read
			// THEN all of them give the same address. This is a stored way of reaching
			// the company, and two spellings kept apart would list one firm as having
			// two Facebooks
			for (const spelling of spellings) {
				expect(socialProfileOf(spelling)?.value).toBe(
					'https://facebook.com/acme',
				)
			}
		})

		it('should keep the capitals an address needs to work', () => {
			// GIVEN a YouTube channel, which is filed under an id where the capitals
			// count
			// WHEN read
			// THEN they survive. Folding an address to lowercase to tidy it would hand
			// back a link to nothing
			expect(
				socialProfileOf('https://www.youtube.com/channel/UCa1B2c3D')?.value,
			).toBe('https://youtube.com/channel/UCa1B2c3D')
		})

		it('should read a page at a host written with a trailing dot', () => {
			// GIVEN the fully-spelled form of the host, which opens the same page
			// WHEN read — THEN the same page, so the dot cannot lose a real channel
			expect(socialProfileOf('https://facebook.com./LIPOTECH.SARL')?.kind).toBe(
				'facebook',
			)
		})
	})

	describe("when the address is not the company's own page", () => {
		it('should refuse the two addresses a market search actually offered', () => {
			// GIVEN the pair a live search handed back as company websites: a share
			// link that spells nothing, and one post
			// WHEN read
			// THEN neither becomes a channel. Recording either as "the company's
			// Facebook" writes down something that was never true
			expect(
				socialProfileOf('https://www.facebook.com/share/1CtPJpK3i7/'),
			).toBeNull()
			expect(
				socialProfileOf('https://www.instagram.com/p/DTxItU0lfKN/'),
			).toBeNull()
		})

		it("should refuse a post inside somebody's group", () => {
			// GIVEN a post in a trade group that has nothing to do with the company
			// WHEN read — THEN not a page anybody opened in their own name
			expect(
				socialProfileOf(
					'https://www.facebook.com/groups/electricienfrance/posts/1408466207156608',
				),
			).toBeNull()
		})

		it("should refuse a person's own profile", () => {
			// GIVEN the profile of somebody who works there
			// WHEN read — THEN a person is not the company, however senior they are
			expect(socialProfileOf('https://www.linkedin.com/in/jane-doe')).toBeNull()
		})

		it('should refuse one item an account published', () => {
			// GIVEN a post, a reel and a video
			// WHEN read — THEN each belongs to an account the address does not name,
			// so there is nothing here to record as anybody's page
			for (const url of [
				'https://x.com/acme/status/123',
				'https://www.instagram.com/reel/xyz/',
				'https://www.tiktok.com/@acme/video/123',
				'https://www.youtube.com/watch?v=abc',
				'https://www.linkedin.com/posts/xyz',
			]) {
				expect(socialProfileOf(url)).toBeNull()
			}
		})

		it('should refuse a shortened video link', () => {
			// GIVEN the shortener a video is shared by, which never points at an
			// account
			// WHEN read — THEN nothing
			expect(socialProfileOf('https://youtu.be/abc123')).toBeNull()
		})

		it('should refuse a word the platform reserved for itself', () => {
			// GIVEN addresses whose first part is the platform's own word rather than
			// anybody's account name
			// WHEN read — THEN refused, since none of them names an account
			for (const url of [
				'https://www.facebook.com/profile.php?id=123',
				'https://www.facebook.com/marketplace/acme',
				'https://x.com/search',
				'https://www.instagram.com/explore/',
			]) {
				expect(socialProfileOf(url)).toBeNull()
			}
		})

		it("should refuse the platform's own home page", () => {
			// GIVEN the platform with nothing after it
			// WHEN read — THEN there is no account here to reach anybody at
			expect(socialProfileOf('https://facebook.com')).toBeNull()
			expect(socialProfileOf('https://facebook.com/')).toBeNull()
		})

		it('should refuse an ordinary company site', () => {
			// GIVEN a company's own website, which is not a platform at all
			// WHEN read — THEN nothing, and the website check keeps it as it always did
			expect(socialProfileOf('https://acme.com/about')).toBeNull()
		})

		it('should refuse a value that is not one address', () => {
			// GIVEN a value with an aside written next to it, which nobody can open
			// WHEN read — THEN nothing
			expect(socialProfileOf('https://facebook.com/acme (probably)')).toBeNull()
			expect(socialProfileOf('')).toBeNull()
		})
	})
})
