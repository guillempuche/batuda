import { describe, expect, it } from 'vitest'

import {
	type GenericEmail,
	harvestGenericEmails,
	withRoleMailbox,
} from './generic-emails'

describe('harvestGenericEmails', () => {
	describe('when a role mailbox is published on the company own domain', () => {
		it('should capture it with the page source id and the line as the quote', () => {
			// GIVEN the company's contact page listing a role address on its own domain
			const pages = [
				{
					text: 'Contact us: info@acme.com',
					host: 'acme.com',
					sourceId: 'src_0123456789abcdef',
				},
			]
			// WHEN harvested against the company's own hosts
			const found = harvestGenericEmails(pages, ['acme.com'])
			// THEN the address is captured, named by the page it was read from
			expect(found).toEqual([
				{
					value: 'info@acme.com',
					source_id: 'src_0123456789abcdef',
					quote: 'Contact us: info@acme.com',
				},
			])
		})

		it('should match a subdomain of an own host', () => {
			// GIVEN a role address on a mail subdomain of the company
			const pages = [
				{ text: 'sales@mail.acme.com', host: 'acme.com', sourceId: 'src_a' },
			]
			// WHEN harvested
			const found = harvestGenericEmails(pages, ['acme.com'])
			// THEN a subdomain of an own host still counts as the company's
			expect(found.map(e => e.value)).toEqual(['sales@mail.acme.com'])
		})
	})

	describe('when the address is not a company role mailbox', () => {
		it('should drop a personal address (a name, not a role)', () => {
			// GIVEN a named person's address on the company site
			const pages = [
				{ text: 'john.smith@acme.com', host: 'acme.com', sourceId: 'src_a' },
			]
			// WHEN harvested
			// THEN only shared role mailboxes are captured, never a person
			expect(harvestGenericEmails(pages, ['acme.com'])).toEqual([])
		})

		it('should drop a role address at a different domain (a testimonial)', () => {
			// GIVEN a supplier's role address quoted on the company's page
			const pages = [
				{
					text: '"Great partner" — info@supplier.com',
					host: 'acme.com',
					sourceId: 'src_a',
				},
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
				{
					text: 'press@acme.com and sales@acme.com',
					host: 'acme.com',
					sourceId: 'src_a',
				},
				{
					text: 'General: contact@acme.com (also sales@acme.com)',
					host: 'acme.com',
					sourceId: 'src_b',
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

		it('should keep each address named by the page it was actually read on', () => {
			// GIVEN the same role word on two different pages of the company site
			const pages = [
				{ text: 'sales@acme.com', host: 'acme.com', sourceId: 'src_sales' },
				{ text: 'info@acme.com', host: 'acme.com', sourceId: 'src_home' },
			]
			// WHEN harvested
			const found = harvestGenericEmails(pages, ['acme.com'])
			// THEN each carries its own page, so provenance survives the re-ordering
			expect(found.map(e => [e.value, e.source_id] as const)).toStrictEqual([
				['info@acme.com', 'src_home'],
				['sales@acme.com', 'src_sales'],
			])
		})
	})

	describe('when there is nothing to capture', () => {
		it('should return empty for pages with no addresses', () => {
			// GIVEN a page with no email at all
			expect(
				harvestGenericEmails(
					[{ text: 'No contact details here.', sourceId: 'src_a' }],
					['acme.com'],
				),
			).toEqual([])
		})

		it('should return empty when no company hosts are known', () => {
			// GIVEN a role address but no own hosts to match against
			// WHEN harvested with an empty host list
			// THEN nothing can be trusted as the company's, so nothing is captured
			expect(
				harvestGenericEmails(
					[{ text: 'info@acme.com', host: 'acme.com', sourceId: 'src_a' }],
					[],
				),
			).toEqual([])
		})

		it('should return empty for no pages at all', () => {
			// GIVEN a run that opened nothing (a resume that re-fetched no page)
			// THEN there is nothing to read an address off
			expect(harvestGenericEmails([], ['acme.com'])).toEqual([])
		})
	})
})

describe('withRoleMailbox', () => {
	const harvested: ReadonlyArray<GenericEmail> = [
		{
			value: 'info@acme.com',
			source_id: 'src_home',
			quote: 'Contact us: info@acme.com',
		},
		{
			value: 'sales@acme.com',
			source_id: 'src_sales',
			quote: 'Sales: sales@acme.com',
		},
	]
	const subject = { id: 'company-1', version: 7 }

	describe('when the run holds the company on file', () => {
		it('should offer the best address as a change and add it to the profile', () => {
			// GIVEN findings that reported no company email
			const findings = { enrichment: { industry: { value: 'logistics' } } }
			// WHEN the harvested mailboxes are folded in
			const next = withRoleMailbox(findings, harvested, subject) as Record<
				string,
				unknown
			>
			// THEN the profile carries the highest-ranked address, sourced to its page
			expect(next['enrichment']).toStrictEqual({
				industry: { value: 'logistics' },
				email: {
					value: 'info@acme.com',
					source_id: 'src_home',
					quote: 'Contact us: info@acme.com',
					confidence: 1,
				},
			})
			// AND the same address is offered as a change against the company row
			expect(next['proposed_updates']).toStrictEqual([
				{
					subject_table: 'companies',
					subject_id: 'company-1',
					expected_version: 7,
					fields: {
						email: {
							value: 'info@acme.com',
							source_id: 'src_home',
							quote: 'Contact us: info@acme.com',
							confidence: 1,
						},
					},
					reason: 'Contact us: info@acme.com',
					citations: [
						{
							source_id: 'src_home',
							quote: 'Contact us: info@acme.com',
							confidence: 1,
						},
					],
				},
			])
		})

		it('should keep the changes the model already proposed', () => {
			// GIVEN findings that already propose an industry correction
			const existing = { subject_table: 'companies', fields: { industry: 'x' } }
			const findings = { enrichment: {}, proposed_updates: [existing] }
			// WHEN the harvested mailbox is folded in
			const next = withRoleMailbox(findings, harvested, subject) as Record<
				string,
				unknown
			>
			// THEN the mailbox is appended rather than replacing what was there
			expect(next['proposed_updates']).toHaveLength(2)
			expect(
				(next['proposed_updates'] as ReadonlyArray<unknown>)[0],
			).toStrictEqual(existing)
		})

		it('should leave an address the model already reported alone', () => {
			// GIVEN the model read a company email off the same pages itself
			const own = { value: 'hola@acme.com', source_id: 'src_home' }
			const findings = { enrichment: { email: own } }
			// WHEN the harvested mailboxes are folded in
			const next = withRoleMailbox(findings, harvested, subject) as {
				enrichment: Record<string, unknown>
			}
			// THEN the model's own reading stands — it saw the same evidence
			expect(next.enrichment['email']).toStrictEqual(own)
		})
	})

	describe('when the run holds no company on file', () => {
		it('should fill the profile but offer no change', () => {
			// GIVEN a discovery run with no company row to write against
			const findings = { enrichment: {} }
			// WHEN the harvested mailbox is folded in with no subject
			const next = withRoleMailbox(findings, harvested, undefined) as Record<
				string,
				unknown
			>
			// THEN the address still reaches the profile
			expect((next['enrichment'] as Record<string, unknown>)['email']).toEqual(
				expect.objectContaining({ value: 'info@acme.com' }),
			)
			// AND nothing is offered, because there is no record to change yet
			expect(next['proposed_updates']).toBeUndefined()
		})
	})

	describe('when there is nothing to fold in', () => {
		it('should return the findings untouched for an empty harvest', () => {
			// GIVEN a run that harvested no role mailbox
			const findings = { enrichment: {} }
			// THEN the findings come back as the same object, not a rebuilt copy
			expect(withRoleMailbox(findings, [], subject)).toBe(findings)
		})

		it('should pass a non-object findings value straight through', () => {
			// GIVEN findings that are not a record (a provider returned a bare value)
			// THEN there is nowhere to fold an address into
			expect(withRoleMailbox(null, harvested, subject)).toBeNull()
			expect(withRoleMailbox([1, 2], harvested, subject)).toStrictEqual([1, 2])
		})
	})

	describe('when the company row carries no version', () => {
		it('should offer the change with a null expected version', () => {
			// GIVEN a subject whose version could not be read
			const findings = { enrichment: {} }
			// WHEN the harvested mailbox is folded in
			const next = withRoleMailbox(findings, harvested, {
				id: 'company-1',
				version: null,
			}) as { proposed_updates: ReadonlyArray<Record<string, unknown>> }
			// THEN the change travels with an explicit null rather than a made-up number
			expect(next.proposed_updates[0]?.['expected_version']).toBeNull()
		})
	})
})
