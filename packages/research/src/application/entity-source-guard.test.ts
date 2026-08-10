import { describe, expect, it } from 'vitest'

import type { EntityTargets } from './entity-guard'
import { classifyNamespace, guardEntitySources } from './entity-source-guard'

// A stand-in target; the namespace rules are structural and don't read it.
const targets: EntityTargets = {
	cores: ['acmefreight'],
	words: ['acme'],
	domains: ['acmefreight.com'],
	places: [],
}

const sourced = (value: unknown, sourceId: string) => ({
	value,
	source_id: sourceId,
	confidence: null,
})

describe('classifyNamespace', () => {
	describe('when the URL is a user-posted item', () => {
		it('should classify social posts and short-form video as ugc', () => {
			expect(
				classifyNamespace('https://www.instagram.com/reel/DavToL1gq3i/'),
			).toBe('ugc')
			expect(classifyNamespace('https://instagram.com/p/Cabc123/')).toBe('ugc')
			expect(classifyNamespace('https://www.tiktok.com/@acme/video/72')).toBe(
				'ugc',
			)
			expect(classifyNamespace('https://www.youtube.com/watch?v=xyz')).toBe(
				'ugc',
			)
			expect(classifyNamespace('https://x.com/acme/status/1789')).toBe('ugc')
			expect(classifyNamespace('https://twitter.com/acme/status/1789')).toBe(
				'ugc',
			)
		})
	})

	describe('when the URL is a person or people-search profile', () => {
		it('should classify it as profile', () => {
			expect(
				classifyNamespace('https://www.zoominfo.com/p/Abdullah-Alhamadi/628'),
			).toBe('profile')
			expect(classifyNamespace('https://www.linkedin.com/in/jane-doe/')).toBe(
				'profile',
			)
			expect(classifyNamespace('https://www.spokeo.com/John-Smith')).toBe(
				'profile',
			)
		})
	})

	describe('when the URL is an ordinary company page', () => {
		it('should not classify it (left to the tier and entity guards)', () => {
			expect(classifyNamespace('https://acmefreight.com/about')).toBeNull()
			// LinkedIn's company namespace is a company page, not a person
			expect(
				classifyNamespace('https://www.linkedin.com/company/acme-freight/'),
			).toBeNull()
			// ZoomInfo's company record namespace, not a person
			expect(
				classifyNamespace('https://www.zoominfo.com/c/acme/123'),
			).toBeNull()
			expect(classifyNamespace('https://growjo.com/company/Acme')).toBeNull()
			expect(classifyNamespace('not a url')).toBeNull()
		})
	})
})

describe('guardEntitySources', () => {
	describe('when a company firmographic is cited to a person profile', () => {
		it('should null it (the Waypoint / ZoomInfo case)', () => {
			// GIVEN a head-count taken from a ZoomInfo person profile, plus a legit
			// industry taken from the company's own page
			const findings = {
				enrichment: {
					industry: sourced('transport', 'https://acmefreight.com'),
					size_range: sourced(
						'51-200',
						'https://www.zoominfo.com/p/Abdullah-Alhamadi/628',
					),
				},
			}

			// WHEN the guard runs
			const out = guardEntitySources(findings, targets)

			// THEN the person-sourced head-count is dropped; the own-page industry stays
			const enrichment = (
				out.findings as { enrichment: Record<string, unknown> }
			).enrichment
			expect(enrichment['size_range']).toBeNull()
			expect(enrichment['industry']).not.toBeNull()
			expect(out.droppedCompanyFields).toBe(1)
		})
	})

	describe('when contacts are cited to a user post', () => {
		it('should drop them (the Advanced Drainage / Instagram reel case)', () => {
			// GIVEN three "executives" whose only source is an Instagram reel
			const findings = {
				contacts: [
					{
						name: 'Scott Barbour',
						role: sourced('CEO', 'https://www.instagram.com/reel/DavToL1gq3i/'),
						citations: [
							{ source_id: 'https://www.instagram.com/reel/DavToL1gq3i/' },
						],
					},
					{
						name: 'Real Person',
						role: sourced('Owner', 'https://acmefreight.com/team'),
						citations: [{ source_id: 'https://acmefreight.com/team' }],
					},
				],
			}

			// WHEN the guard runs
			const out = guardEntitySources(findings, targets)

			// THEN the reel-sourced contact is gone and the own-page one survives
			const contacts = (out.findings as { contacts: { name: string }[] })
				.contacts
			expect(contacts).toHaveLength(1)
			expect(contacts[0]?.name).toBe('Real Person')
			expect(out.droppedContacts).toBe(1)
		})
	})

	describe('when a contact is cited to a user post AND to a first-party page', () => {
		it('should keep them — a post is only disqualifying as the sole tie', () => {
			// GIVEN a named executive the company lists on its own team page and also
			// announces on its Instagram, so their sources are one of each
			const findings = {
				contacts: [
					{
						name: 'Scott Barbour',
						role: sourced('CEO', 'https://acmefreight.com/team'),
						citations: [
							{ source_id: 'https://acmefreight.com/team' },
							{ source_id: 'https://www.instagram.com/reel/DavToL1gq3i/' },
						],
					},
				],
			}

			// WHEN the guard runs
			const out = guardEntitySources(findings, targets)

			// THEN the contact survives, and nothing is reported as a drop — the post
			// is not what the contact rests on
			const contacts = (out.findings as { contacts: { name: string }[] })
				.contacts
			expect(contacts).toHaveLength(1)
			expect(contacts[0]?.name).toBe('Scott Barbour')
			expect(out.droppedContacts).toBe(0)
			expect(out.droppedUncited).toBe(0)
		})

		it('should still drop a contact whose every source is a post', () => {
			// GIVEN a contact cited to two posts and nothing else — different hosts,
			// but not one page the company stands behind
			const findings = {
				contacts: [
					{
						name: 'Reel Person',
						role: sourced('CEO', 'https://www.instagram.com/reel/DavToL1gq3i/'),
						citations: [{ source_id: 'https://x.com/acme/status/1789' }],
					},
				],
			}

			// WHEN the guard runs — THEN it goes, counted as the drop it is
			const out = guardEntitySources(findings, targets)
			expect((out.findings as { contacts: unknown[] }).contacts).toHaveLength(0)
			expect(out.droppedContacts).toBe(1)
		})
	})

	describe('when a contact is cited to their own professional profile', () => {
		it('should keep it (a person page is fine for that person)', () => {
			// GIVEN a contact whose role is cited to their own LinkedIn profile
			const findings = {
				contacts: [
					{
						name: 'Jane Doe',
						role: sourced('COO', 'https://www.linkedin.com/in/jane-doe/'),
						citations: [{ source_id: 'https://www.linkedin.com/in/jane-doe/' }],
					},
				],
			}

			// WHEN the guard runs
			const out = guardEntitySources(findings, targets)

			// THEN the contact is kept — a person's own profile can source their role
			expect((out.findings as { contacts: unknown[] }).contacts).toHaveLength(1)
			expect(out.droppedContacts).toBe(0)
		})
	})

	describe('when a contact carries no provenance', () => {
		it('should drop a bare name with no citation and no sourced role/email', () => {
			// GIVEN the pattern seen in the field: 8 contacts, only 1 cited, the rest
			// bare names with role/email/citations all empty
			const findings = {
				contacts: [
					{
						name: 'Cited Person',
						role: sourced('CEO', 'https://acmefreight.com/team'),
						citations: [{ source_id: 'https://acmefreight.com/team' }],
					},
					{ name: 'Bare Name', role: null, email: null, citations: [] },
				],
			}

			// WHEN the guard runs
			const out = guardEntitySources(findings, targets)

			// THEN the unprovenanced contact is dropped, the cited one kept
			const contacts = (out.findings as { contacts: { name: string }[] })
				.contacts
			expect(contacts).toHaveLength(1)
			expect(contacts[0]?.name).toBe('Cited Person')
			expect(out.droppedUncited).toBe(1)
		})
	})

	describe('when there is nothing structural to block', () => {
		it('should leave ordinary findings untouched', () => {
			const findings = {
				enrichment: {
					industry: sourced('transport', 'https://acmefreight.com'),
				},
			}
			const out = guardEntitySources(findings, targets)
			expect(out.droppedCompanyFields).toBe(0)
			expect(out.droppedContacts).toBe(0)
		})

		it('should return a non-object result unchanged', () => {
			const out = guardEntitySources({ error: 'no data' }, targets)
			expect(out.findings).toEqual({ error: 'no data' })
		})
	})

	describe('when company fields cite pages fetched this run', () => {
		const pages: Record<string, { text: string; host?: string }> = {
			'https://lookalike.com/about': {
				text: 'CEVA is a global freight leader',
				host: 'lookalike.com',
			},
			'https://news.example.com/story': {
				text: 'Acme announces a new warehouse',
				host: 'news.example.com',
			},
			'https://acmefreight.com/offices': {
				text: 'Head office: 12 Main St, Springfield',
				host: 'acmefreight.com',
			},
		}
		const resolve = (sourceId: string) => pages[sourceId]

		it('should drop a field whose cited page reads as a different company', () => {
			// GIVEN a head-count cited to a fetched page that names another company
			const findings = {
				enrichment: {
					size_range: sourced('51-200', 'https://lookalike.com/about'),
				},
			}

			// WHEN the guard runs with the fetched pages in hand
			const out = guardEntitySources(findings, targets, resolve)

			// THEN the wrong-company field is dropped, counted apart from namespace drops
			const enrichment = (
				out.findings as { enrichment: Record<string, unknown> }
			).enrichment
			expect(enrichment['size_range']).toBeNull()
			expect(out.droppedOffEntity).toBe(1)
			expect(out.droppedCompanyFields).toBe(0)
		})

		it('should keep a field whose page mentions the company only weakly', () => {
			// GIVEN an industry cited to a news page naming "Acme" but not the full name
			const findings = {
				enrichment: {
					industry: sourced('logistics', 'https://news.example.com/story'),
				},
			}

			// WHEN the guard runs — THEN the weak-but-right-company value ships
			// (down-weighting it is the source-tier guard's job, not a drop here)
			const out = guardEntitySources(findings, targets, resolve)
			const enrichment = (
				out.findings as { enrichment: Record<string, unknown> }
			).enrichment
			expect(enrichment['industry']).not.toBeNull()
			expect(out.droppedOffEntity).toBe(0)
		})

		it('should keep an own-domain page that never spells the name', () => {
			// GIVEN an HQ cited to the company's own offices page, whose body is only
			// an address
			const findings = {
				enrichment: {
					hq: sourced('Springfield', 'https://acmefreight.com/offices'),
				},
			}

			// WHEN the guard runs — THEN the own-domain page grounds on its host alone
			const out = guardEntitySources(findings, targets, resolve)
			const enrichment = (
				out.findings as { enrichment: Record<string, unknown> }
			).enrichment
			expect(enrichment['hq']).not.toBeNull()
			expect(out.droppedOffEntity).toBe(0)
		})

		it('should keep a field whose citation was never fetched', () => {
			// GIVEN a field cited to a search result the run never scraped
			const findings = {
				enrichment: {
					founded_year: sourced(2004, 'https://never-fetched.com/profile'),
				},
			}

			// WHEN the guard runs — THEN it fails open: only a page it actually saw
			// can void a field
			const out = guardEntitySources(findings, targets, resolve)
			const enrichment = (
				out.findings as { enrichment: Record<string, unknown> }
			).enrichment
			expect(enrichment['founded_year']).not.toBeNull()
			expect(out.droppedOffEntity).toBe(0)
		})

		it('should leave contacts to the structural rules alone', () => {
			// GIVEN a contact cited to a fetched page that reads as another company —
			// whether a person belongs to the company is the contact critic's
			// judgment, not this guard's
			const findings = {
				contacts: [
					{
						name: 'Jane Doe',
						role: sourced('CEO', 'https://lookalike.com/about'),
						citations: [{ source_id: 'https://lookalike.com/about' }],
					},
				],
			}

			// WHEN the guard runs — THEN the contact survives the page-text check
			const out = guardEntitySources(findings, targets, resolve)
			expect((out.findings as { contacts: unknown[] }).contacts).toHaveLength(1)
		})
	})
})
