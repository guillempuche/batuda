import { describe, expect, it } from 'vitest'

import {
	citationSourceResolver,
	groundedCitationTest,
	validateFindingCitations,
} from './citation-guard'

const SOURCES = [
	{
		localRef: 'https://www.verpack.fr/contact',
		sourceId: 'src_85e82a765bad88de',
	},
	{ localRef: 'https://www.einforma.com/decoletaje-macla', sourceId: 'src_1' },
	{ localRef: 'https://acme.es/about', sourceId: 'src_2' },
	{ localRef: 'https://acme.es/team', sourceId: 'src_3' },
]

const PAGES = [
	{
		sourceId: 'src_1',
		text: 'Número de empleados = 23 (año 2024). Decoletaje Macla.',
	},
	{ sourceId: 'src_2', text: 'Acme about page: founded in 1950.' },
	{ sourceId: 'src_3', text: 'Acme team: Ana Puig, CEO.' },
]

describe('citationSourceResolver, over the ids a model cites by', () => {
	it("should put an opaque page id back to the page's address", () => {
		// GIVEN the manifest's own label for a fetched page
		const resolve = citationSourceResolver(SOURCES, PAGES)
		// THEN the reader gets the address
		expect(resolve('src_85e82a765bad88de')).toBe(
			'https://www.verpack.fr/contact',
		)
	})

	it('should put a bare host back to the one fetched page of it that says the words', () => {
		// GIVEN a host with one fetched page carrying the quoted words
		const resolve = citationSourceResolver(SOURCES, PAGES)
		// THEN that page is named
		expect(resolve('einforma.com', 'Número de empleados = 23')).toBe(
			'https://www.einforma.com/decoletaje-macla',
		)
		// AND a host with two pages names the one that says the words
		expect(resolve('acme.es', 'Ana Puig, CEO')).toBe('https://acme.es/team')
	})

	it('should leave a bare host as written when no page, or no one page, says the words', () => {
		// GIVEN words on no fetched page of the host, words with no page text
		// to check, and a citation with no words at all
		const resolve = citationSourceResolver(SOURCES, PAGES)
		expect(resolve('einforma.com', 'ventas 2 millones')).toBe('einforma.com')
		expect(resolve('einforma.com')).toBe('einforma.com')
		expect(citationSourceResolver(SOURCES)('einforma.com', 'Número')).toBe(
			'einforma.com',
		)
		// AND a full address is left alone
		expect(resolve('https://acme.es/about')).toBe('https://acme.es/about')
		expect(resolve('https://nowhere.test/x')).toBe('https://nowhere.test/x')
	})

	it('should leave an id no fetched page answers to as written', () => {
		// GIVEN an opaque id from no manifest of this run, a host it fetched
		// nothing on, and a bare word that is no address
		const resolve = citationSourceResolver(SOURCES, PAGES)
		// THEN none is guessed at
		expect(resolve('src_ffffffffffffffff')).toBe('src_ffffffffffffffff')
		expect(resolve('nowhere.test', 'anything')).toBe('nowhere.test')
		expect(resolve('unknown', 'Acme about page')).toBe('unknown')
	})
})

describe('validateFindingCitations, with the words a run read in hand', () => {
	const isGrounded = groundedCitationTest(SOURCES)
	const corpus =
		'segons explica el seu propietari, ramon vendrell. acme about page.'

	describe('when a contact carries the real line and a reworded one', () => {
		it('should keep the real citation and fold the reworded one into it, counted', () => {
			// GIVEN a Catalan quote from the page and the model's Spanish rewrite of it
			const findings = {
				contacts: [
					{
						name: 'Ramon Vendrell',
						citations: [
							{
								quote: 'segons explica el seu propietari, Ramon Vendrell',
								source_id: 'https://acme.es/about',
							},
							{
								quote: 'según explica el su propietario, Ramon Vendrell',
								source_id: 'https://acme.es/about',
							},
						],
					},
				],
			}
			// WHEN validated with the corpus
			const result = validateFindingCitations(findings, isGrounded, {
				lowerCorpus: corpus,
			})
			// THEN one citation stays, with the page's own words: the rewrite lost
			// its words and, saying no more than the real one, folded into it
			const citations = (
				result.findings as {
					contacts: Array<{ citations: Array<{ quote?: string }> }>
				}
			).contacts[0]?.citations
			expect(citations).toHaveLength(1)
			expect(citations?.[0]?.quote).toBe(
				'segons explica el seu propietari, Ramon Vendrell',
			)
			expect(result.strippedQuotes).toBe(1)
			expect(result.folded).toBe(1)
			expect(result.kept).toBe(1)
		})
	})

	describe('when a citation names the page by its opaque id', () => {
		it('should store the address instead', () => {
			// GIVEN an email evidenced to a src_ id
			const findings = {
				enrichment: {
					evidence: {
						email: {
							value: 'contact@verpack.fr',
							source_id: 'src_85e82a765bad88de',
							quote: 'Mail : contact@verpack.fr',
						},
					},
				},
			}
			// WHEN validated with the resolver
			const result = validateFindingCitations(findings, isGrounded, {
				resolve: citationSourceResolver(SOURCES),
			})
			// THEN the evidence names the page
			expect(
				(
					result.findings as {
						enrichment: { evidence: { email: { source_id: string } } }
					}
				).enrichment.evidence.email.source_id,
			).toBe('https://www.verpack.fr/contact')
			expect(result.kept).toBe(1)
		})
	})

	describe('when a contact cites the page by its opaque id', () => {
		it('should store the address on the citation itself', () => {
			// GIVEN a citation naming the page the way the manifest labelled it
			const findings = {
				contacts: [
					{
						name: 'Ramon Vendrell',
						citations: [{ quote: 'acme about page', source_id: 'src_2' }],
					},
				],
			}
			// WHEN validated with the resolver and the corpus
			const result = validateFindingCitations(findings, isGrounded, {
				resolve: citationSourceResolver(SOURCES),
				lowerCorpus: corpus,
			})
			// THEN a reader is given the address
			const citations = (
				result.findings as {
					contacts: Array<{ citations: Array<{ source_id: string }> }>
				}
			).contacts[0]?.citations
			expect(citations?.[0]?.source_id).toBe('https://acme.es/about')
		})
	})

	describe('when a citation quotes nothing', () => {
		it('should keep it — there are no words to hold to the page', () => {
			// GIVEN a citation with no quote and one whose quote is blank
			const findings = {
				contacts: [
					{
						name: 'X',
						citations: [
							{ source_id: 'https://acme.es/team' },
							{ quote: '   ', source_id: 'https://acme.es/about' },
						],
					},
				],
			}
			// WHEN validated with the corpus
			const result = validateFindingCitations(findings, isGrounded, {
				lowerCorpus: corpus,
			})
			// THEN both stay
			expect(result.kept).toBe(2)
			expect(result.strippedQuotes).toBe(0)
		})
	})

	describe('when a proposed write quotes a line no page wrote', () => {
		it('should keep the write with its page and take the words off', () => {
			// GIVEN a proposed update backed by a fetched page and a reworded line
			const findings = {
				proposed_updates: [
					{
						subject_table: 'companies',
						subject_id: 'co-1',
						fields: { industry: 'transport' },
						citations: [
							{
								quote: 'la empresa se dedica al transporte de mercancías',
								source_id: 'https://acme.es/about',
							},
						],
					},
				],
			}
			// WHEN validated with the corpus
			const result = validateFindingCitations(findings, isGrounded, {
				lowerCorpus: corpus,
			})
			// THEN the write stays, cited to the page with no words claimed for it
			const proposals = (
				result.findings as {
					proposed_updates: Array<{
						citations: Array<{ source_id: string; quote?: string }>
					}>
				}
			).proposed_updates
			expect(proposals).toHaveLength(1)
			expect(proposals[0]?.citations).toEqual([
				{ source_id: 'https://acme.es/about' },
			])
			expect(result.strippedQuotes).toBe(1)
		})
	})

	describe("when a person's only line is the model's remark about the page", () => {
		it('should keep the person on the page, without the remark', () => {
			// GIVEN a name read off a photo caption, quoted with a remark
			const findings = {
				contacts: [
					{
						name: 'Tomás Filipe',
						citations: [
							{
								quote: 'Tomás Filipe (appears in Sales photo carousel)',
								source_id: 'https://acme.es/about',
							},
						],
					},
				],
			}
			// WHEN validated with the corpus
			const result = validateFindingCitations(findings, isGrounded, {
				lowerCorpus: corpus,
			})
			// THEN the citation stays, page only, and nobody is left uncited
			const citations = (
				result.findings as { contacts: Array<{ citations: unknown[] }> }
			).contacts[0]?.citations
			expect(citations).toEqual([{ source_id: 'https://acme.es/about' }])
			expect(result.kept).toBe(1)
			expect(result.strippedQuotes).toBe(1)
		})
	})

	describe('when no corpus is given', () => {
		it('should judge the source only, as before', () => {
			// GIVEN a reworded quote on a fetched page
			const findings = {
				contacts: [
					{
						name: 'X',
						citations: [
							{ quote: 'anything at all', source_id: 'https://acme.es/team' },
						],
					},
				],
			}
			// WHEN validated without a corpus
			const result = validateFindingCitations(findings, isGrounded)
			// THEN the citation stays
			expect(result.kept).toBe(1)
			expect(result.strippedQuotes).toBe(0)
		})
	})
})

describe('validateFindingCitations, when one page is cited several times over', () => {
	const isGrounded = groundedCitationTest(SOURCES)

	it('should keep one citation per page and wording, once the ids are put back', () => {
		// GIVEN the same line cited by the page's id, by its address, and in
		// another breaking of the line, plus a different page
		const findings = {
			contacts: [
				{
					name: 'Ana Puig',
					citations: [
						{ quote: 'Ana Puig, CEO', source_id: 'src_3' },
						{ quote: 'Ana Puig,\nCEO', source_id: 'https://acme.es/team' },
						{ quote: 'Ana Puig, CEO', source_id: 'https://acme.es/team/' },
						{ quote: 'founded in 1950', source_id: 'https://acme.es/about' },
					],
				},
			],
		}
		// WHEN validated with the resolver
		const result = validateFindingCitations(findings, isGrounded, {
			resolve: citationSourceResolver(SOURCES, PAGES),
		})
		// THEN the team page is cited once, the about page once
		const citations = (
			result.findings as {
				contacts: Array<{ citations: Array<{ source_id: string }> }>
			}
		).contacts[0]?.citations
		expect(citations?.map(c => c.source_id)).toEqual([
			'https://acme.es/team',
			'https://acme.es/about',
		])
		expect(result.folded).toBe(2)
		expect(result.kept).toBe(2)
	})

	it('should fold two citations of one page that quote nothing', () => {
		// GIVEN a person cited twice to one page with no words either time
		const findings = {
			prospects: [
				{
					name: 'Acme',
					contacts: [
						{
							name: 'Ana Puig',
							citations: [
								{ source_id: 'https://acme.es/team' },
								{ source_id: 'https://acme.es/team' },
								{ source_id: 'https://acme.es/about' },
							],
						},
					],
				},
			],
		}
		// WHEN validated
		const result = validateFindingCitations(findings, isGrounded)
		// THEN the page is cited once, however deep the list sits
		const citations = (
			result.findings as {
				prospects: Array<{
					contacts: Array<{ citations: Array<{ source_id: string }> }>
				}>
			}
		).prospects[0]?.contacts[0]?.citations
		expect(citations?.map(c => c.source_id)).toEqual([
			'https://acme.es/team',
			'https://acme.es/about',
		])
		expect(result.folded).toBe(1)
	})
})
