import { describe, expect, it } from 'vitest'

import { rescueSocialWebsites } from './social-website-rescue'

// A scanned company the way a market search returns one.
const scan = (rows: ReadonlyArray<{ name: string; website?: string }>) => ({
	prospects: rows.map(({ name, website }) => ({
		name,
		...(website === undefined ? {} : { website }),
		citations: [],
	})),
})

const rowsOf = (findings: unknown) =>
	(
		findings as {
			prospects: Array<{
				website?: string
				social_profiles?: Array<{ kind: string; value: string }>
			}>
		}
	).prospects

describe('rescueSocialWebsites', () => {
	describe('when a scanned company was given its page on a platform', () => {
		it('should move the page onto the company and empty the website', () => {
			// GIVEN a small firm with no site of its own, handed back the only web
			// presence anybody could find for it
			const findings = scan([
				{
					name: 'LIPOTECH SARL',
					website: 'https://www.facebook.com/LIPOTECH.SARL',
				},
			])

			// WHEN the pages are rescued
			// THEN the company ends up with no website and a Facebook page, which is
			// the truth about it
			const result = rescueSocialWebsites(findings)
			expect(result.rescued).toBe(1)
			expect(rowsOf(result.findings)[0]?.website).toBeUndefined()
			expect(rowsOf(result.findings)[0]?.social_profiles).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/LIPOTECH.SARL' },
			])
		})

		it('should keep the pages a company already reported', () => {
			// GIVEN a company that reported its Instagram itself and was also handed
			// its Facebook page as a website
			const findings = {
				prospects: [
					{
						name: 'Acme',
						website: 'https://www.facebook.com/acme',
						social_profiles: [
							{ kind: 'instagram', value: 'https://instagram.com/acme' },
						],
						citations: [],
					},
				],
			}

			// WHEN rescued
			// THEN the rescued page joins the one already there rather than replacing
			// it, since a company reached two ways is reachable both of them
			const result = rescueSocialWebsites(findings)
			expect(rowsOf(result.findings)[0]?.social_profiles).toEqual([
				{ kind: 'instagram', value: 'https://instagram.com/acme' },
				{ kind: 'facebook', value: 'https://facebook.com/acme' },
			])
		})

		it('should not report one page twice when two rounds spell it differently', () => {
			// GIVEN one round that wrote the page with the www and the next that wrote
			// it without, which is what a run folding several readings together meets
			const once = rescueSocialWebsites(
				scan([{ name: 'Acme', website: 'https://www.facebook.com/acme' }]),
			)
			const rows = rowsOf(once.findings)
			const again = {
				prospects: [{ ...rows[0], website: 'https://facebook.com/acme/' }],
			}

			// WHEN the second spelling is rescued onto the same row
			// THEN it is recognised as the page already there, so the company is not
			// listed as having two Facebooks
			const twice = rescueSocialWebsites(again)
			expect(twice.rescued).toBe(1)
			expect(rowsOf(twice.findings)[0]?.social_profiles).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/acme' },
			])
		})

		it('should not report one page twice when the answer is read again', () => {
			// GIVEN an answer already rescued once — which is what a later round sees,
			// since a run reads its list several times and folds the readings together
			const once = rescueSocialWebsites(
				scan([{ name: 'Acme', website: 'https://www.facebook.com/acme' }]),
			)

			// WHEN it is rescued again
			// THEN nothing moves and nothing is counted: the page is already where it
			// belongs, and a second copy would read as two pages
			const twice = rescueSocialWebsites(once.findings)
			expect(twice.rescued).toBe(0)
			expect(rowsOf(twice.findings)[0]?.social_profiles).toHaveLength(1)
		})
	})

	describe('when the run named the pages itself', () => {
		it('should read a reported page into one spelling', () => {
			// GIVEN a run that named the page outright, in the form a shared mobile
			// link takes
			const findings = {
				prospects: [
					{
						name: 'Atelier Voltaire',
						social_profiles: [
							{
								kind: 'facebook',
								value: 'https://m.facebook.com/atelier.voltaire/?ref=share',
							},
						],
						citations: [],
					},
				],
			}

			// WHEN read
			// THEN it is stored under the one address that page has. This becomes a
			// way of reaching the company, and the same page written two ways would be
			// listed as two Facebooks
			const result = rescueSocialWebsites(findings)
			expect(rowsOf(result.findings)[0]?.social_profiles).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/atelier.voltaire' },
			])
		})

		it('should fold two spellings of one page into one', () => {
			// GIVEN the same page named twice, as two rounds of a run would
			const findings = {
				prospects: [
					{
						name: 'Acme',
						social_profiles: [
							{ kind: 'facebook', value: 'https://www.facebook.com/acme/' },
							{ kind: 'facebook', value: 'https://facebook.com/acme' },
						],
						citations: [],
					},
				],
			}

			// WHEN read — THEN one page, once
			const result = rescueSocialWebsites(findings)
			expect(rowsOf(result.findings)[0]?.social_profiles).toEqual([
				{ kind: 'facebook', value: 'https://facebook.com/acme' },
			])
		})

		it('should drop a reported page that is really a post', () => {
			// GIVEN a run that named a post as the company's Facebook
			const findings = {
				prospects: [
					{
						name: 'Acme',
						social_profiles: [
							{
								kind: 'facebook',
								value: 'https://www.facebook.com/share/1CtPJpK3i7/',
							},
						],
						citations: [],
					},
				],
			}

			// WHEN read
			// THEN dropped. A post is no more the company's page here than it is in
			// the website field, and recording it would say something untrue
			const result = rescueSocialWebsites(findings)
			expect(rowsOf(result.findings)[0]?.social_profiles).toEqual([])
		})

		it('should keep a page on a platform it does not know', () => {
			// GIVEN a page on a platform this reading has never been taught
			const findings = {
				prospects: [
					{
						name: 'Acme',
						social_profiles: [
							{ kind: 'pinterest', value: 'https://pinterest.com/acme' },
						],
						citations: [],
					},
				],
			}

			// WHEN read
			// THEN kept exactly as it arrived. The field is open on purpose, and
			// refusing an address for being unfamiliar would throw away the very thing
			// that openness is for
			const result = rescueSocialWebsites(findings)
			expect(rowsOf(result.findings)[0]?.social_profiles).toEqual([
				{ kind: 'pinterest', value: 'https://pinterest.com/acme' },
			])
		})
	})

	describe('when the address is not a page the company opened', () => {
		it('should leave the two addresses a market search actually offered', () => {
			// GIVEN the pair a live search handed back: a share link that spells
			// nothing, and one post
			const findings = scan([
				{
					name: 'CélestInstallations',
					website: 'https://www.facebook.com/share/1CtPJpK3i7/',
				},
				{
					name: 'OneFire',
					website: 'https://www.instagram.com/p/DTxItU0lfKN/',
				},
			])

			// WHEN rescued
			// THEN neither moves. Recording either as "the company's Facebook" writes
			// down something that was never true, and the website check still has its
			// say on both
			const result = rescueSocialWebsites(findings)
			expect(result.rescued).toBe(0)
			expect(rowsOf(result.findings).map(r => r.website)).toEqual([
				'https://www.facebook.com/share/1CtPJpK3i7/',
				'https://www.instagram.com/p/DTxItU0lfKN/',
			])
		})

		it("should leave a company's own website alone", () => {
			// GIVEN the ordinary case this must never touch
			// WHEN rescued — THEN the site stays exactly where it was
			const result = rescueSocialWebsites(
				scan([{ name: 'Acme Logistics', website: 'https://acme.com' }]),
			)
			expect(result.rescued).toBe(0)
			expect(rowsOf(result.findings)[0]?.website).toBe('https://acme.com')
			expect(rowsOf(result.findings)[0]?.social_profiles).toBeUndefined()
		})

		it('should leave a row with no website at all', () => {
			// GIVEN a company the run found no address for
			// WHEN rescued — THEN nothing to move, and no empty list invented
			const result = rescueSocialWebsites(scan([{ name: 'Acme' }]))
			expect(result.rescued).toBe(0)
			expect(rowsOf(result.findings)[0]?.social_profiles).toBeUndefined()
		})
	})

	describe('when the answer is about one named company', () => {
		it('should empty the website it was asked for and record the page', () => {
			// GIVEN the run's own answer for the company it was asked about, where the
			// website arrives wrapped with the page it was read from
			const findings = {
				enrichment: {
					website: {
						value: 'https://www.facebook.com/LIPOTECH.SARL',
						source_id: 'src_1',
					},
					industry: { value: 'electrical installation' },
				},
			}

			// WHEN rescued
			// THEN the field is emptied rather than removed, so a reader still sees it
			// was asked for, and the page sits beside it as a way of reaching the
			// company
			const result = rescueSocialWebsites(findings)
			expect(result.rescued).toBe(1)
			expect(result.findings).toEqual({
				enrichment: {
					website: null,
					industry: { value: 'electrical installation' },
					social_profiles: [
						{
							kind: 'facebook',
							value: 'https://facebook.com/LIPOTECH.SARL',
						},
					],
				},
			})
		})

		it('should leave the website it was asked for when it is a real site', () => {
			// GIVEN the same shape holding the company's own domain
			// WHEN rescued — THEN untouched
			const findings = {
				enrichment: {
					website: { value: 'https://acme.com', source_id: 'src_1' },
				},
			}
			const result = rescueSocialWebsites(findings)
			expect(result.rescued).toBe(0)
			expect(result.findings).toEqual(findings)
		})
	})

	describe('when the answer holds something that is not a company', () => {
		it("should not read a person's page out of a proposed update", () => {
			// GIVEN a proposal about a contact, which carries its own name and may
			// carry an address — matching it here would rewrite somebody's proposal
			const findings = {
				proposed_updates: [
					{
						subject_table: 'contacts',
						name: 'Jane Doe',
						website: 'https://www.facebook.com/jane.doe',
					},
				],
			}

			// WHEN rescued — THEN the subtree is copied through whole
			const result = rescueSocialWebsites(findings)
			expect(result.rescued).toBe(0)
			expect(result.findings).toEqual(findings)
		})

		it('should leave findings that are not objects untouched', () => {
			// GIVEN answers with nothing to walk
			// WHEN rescued — THEN they pass straight through
			expect(rescueSocialWebsites(null).findings).toBeNull()
			expect(rescueSocialWebsites('text').findings).toBe('text')
			expect(rescueSocialWebsites([1, 2]).findings).toEqual([1, 2])
		})
	})
})
