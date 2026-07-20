import { describe, expect, it } from 'vitest'

import { harvestGenericEmails } from './generic-emails'

describe('harvestGenericEmails', () => {
	describe('when a role mailbox is published on the company own domain', () => {
		it('should capture it with the page host and the line as the quote', () => {
			// GIVEN the company's contact page listing a role address on its own domain
			const pages = [{ text: 'Contact us: info@acme.com', host: 'acme.com' }]
			// WHEN harvested against the company's own hosts
			const found = harvestGenericEmails(pages, ['acme.com'])
			// THEN the address is captured, grounded to the page it was read from
			expect(found).toEqual([
				{
					value: 'info@acme.com',
					source_id: 'acme.com',
					quote: 'Contact us: info@acme.com',
				},
			])
		})

		it('should match a subdomain of an own host', () => {
			// GIVEN a role address on a mail subdomain of the company
			const pages = [{ text: 'sales@mail.acme.com', host: 'acme.com' }]
			// WHEN harvested
			const found = harvestGenericEmails(pages, ['acme.com'])
			// THEN a subdomain of an own host still counts as the company's
			expect(found.map(e => e.value)).toEqual(['sales@mail.acme.com'])
		})
	})

	describe('when the address is not a company role mailbox', () => {
		it('should drop a personal address (a name, not a role)', () => {
			// GIVEN a named person's address on the company site
			const pages = [{ text: 'john.smith@acme.com', host: 'acme.com' }]
			// WHEN harvested
			// THEN only shared role mailboxes are captured, never a person
			expect(harvestGenericEmails(pages, ['acme.com'])).toEqual([])
		})

		it('should drop a role address at a different domain (a testimonial)', () => {
			// GIVEN a supplier's role address quoted on the company's page
			const pages = [
				{ text: '"Great partner" — info@supplier.com', host: 'acme.com' },
			]
			// WHEN harvested against the company's own hosts
			// THEN an address that is not at a company domain is ignored
			expect(harvestGenericEmails(pages, ['acme.com'])).toEqual([])
		})
	})

	describe('when several role mailboxes are published', () => {
		it('should de-duplicate and order by role preference', () => {
			// GIVEN press, sales, and contact addresses across two fetched pages
			const pages = [
				{ text: 'press@acme.com and sales@acme.com', host: 'acme.com' },
				{
					text: 'General: contact@acme.com (also sales@acme.com)',
					host: 'acme.com',
				},
			]
			// WHEN harvested
			const found = harvestGenericEmails(pages, ['acme.com'])
			// THEN each address appears once, general contact first, press last
			expect(found.map(e => e.value)).toEqual([
				'contact@acme.com',
				'sales@acme.com',
				'press@acme.com',
			])
		})
	})

	describe('when there is nothing to capture', () => {
		it('should return empty for pages with no addresses', () => {
			// GIVEN a page with no email at all
			expect(
				harvestGenericEmails(
					[{ text: 'No contact details here.' }],
					['acme.com'],
				),
			).toEqual([])
		})

		it('should return empty when no company hosts are known', () => {
			// GIVEN a role address but no own hosts to match against
			// WHEN harvested with an empty host list
			// THEN nothing can be trusted as the company's, so nothing is captured
			expect(
				harvestGenericEmails([{ text: 'info@acme.com', host: 'acme.com' }], []),
			).toEqual([])
		})
	})
})
