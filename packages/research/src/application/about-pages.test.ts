import { describe, expect, it } from 'vitest'

import { aboutPageCandidates } from './about-pages'

describe('aboutPageCandidates', () => {
	describe('when the homepage links include about/team/contact pages', () => {
		it('should return same-site pages, people first, capped at max', () => {
			// GIVEN a homepage's links: own-site about/team/contact pages, plus a blog
			// post that merely uses the word "team", an off-site link, and the homepage
			const links = [
				'https://acme.com/',
				'https://acme.com/contact',
				'https://acme.com/about-us',
				'https://acme.com/our-team',
				'https://acme.com/products',
				'https://www.acme.com/leadership',
				'https://twitter.com/acme',
				'https://acme.com/blog/team-building',
			]

			// WHEN we pick candidates on acme.com, max 3
			const result = aboutPageCandidates(links, 'acme.com', 3)

			// THEN people pages rank first, then about, then contact; the blog post,
			// off-site link, homepage, and product page are all dropped
			expect(result).toEqual([
				'https://acme.com/our-team',
				'https://www.acme.com/leadership',
				'https://acme.com/about-us',
			])
		})
	})

	describe('when links point off-site or to a subdomain', () => {
		it('should keep only pages on the exact target host', () => {
			// GIVEN a directory profile and a careers subdomain alongside the real page
			const links = [
				'https://directory.example.com/acme/about',
				'https://careers.acme.com/team',
				'https://acme.com/about',
			]

			// WHEN filtered to acme.com — THEN only the exact-host page survives
			expect(aboutPageCandidates(links, 'acme.com', 3)).toEqual([
				'https://acme.com/about',
			])
		})
	})

	describe('when there are more candidates than max', () => {
		it('should keep the highest-ranked and dedupe a fragment link', () => {
			// GIVEN a contact, a team page, the same team page with a fragment, and about
			const links = [
				'https://acme.com/contact',
				'https://acme.com/team',
				'https://acme.com/team#ceo',
				'https://acme.com/about',
			]

			// WHEN max is 1 — THEN the people page wins and the fragment is not a 2nd entry
			expect(aboutPageCandidates(links, 'acme.com', 1)).toEqual([
				'https://acme.com/team',
			])
		})
	})

	describe('when a non-English site is used', () => {
		it('should still match localized about/team paths by their keyword', () => {
			// GIVEN Spanish and Catalan about/team paths
			const links = [
				'https://acme.es/nosotros',
				'https://acme.es/equipo',
				'https://acme.es/productos',
			]

			// WHEN picked — THEN the localized pages match (team band first)
			expect(aboutPageCandidates(links, 'acme.es', 3)).toEqual([
				'https://acme.es/equipo',
				'https://acme.es/nosotros',
			])
		})
	})

	describe('when no link is an about/team/contact page', () => {
		it('should return nothing', () => {
			// GIVEN only a homepage and product/pricing pages
			const links = [
				'https://acme.com/',
				'https://acme.com/products',
				'https://acme.com/pricing',
			]

			// WHEN picked — THEN there is nothing worth fetching
			expect(aboutPageCandidates(links, 'acme.com', 3)).toEqual([])
		})
	})
})
