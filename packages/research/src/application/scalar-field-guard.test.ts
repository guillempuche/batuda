import { describe, expect, it } from 'vitest'

import { guardScalarFields } from './scalar-field-guard'

// The evidence the run gathered, against which quotes are checked. Kept small and
// explicit per test so it is obvious what is and isn't grounded.
interface EnrichmentView {
	industry?: unknown
	size_range?: unknown
	location?: unknown
	country?: unknown
	address?: unknown
	current_tools?: unknown
}
const enrichment = (findings: unknown): EnrichmentView =>
	(findings as { enrichment: EnrichmentView }).enrichment

describe('guardScalarFields', () => {
	describe('when a field holds a placeholder or the schema word', () => {
		it('should drop the literal word "headquarters" in the location field', () => {
			// GIVEN the Circle case: the extractor echoed the schema instead of a place
			const findings = {
				enrichment: {
					location: {
						value: 'headquarters',
						source_id: 'https://circle.com',
						confidence: null,
					},
				},
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'circle logistics fort wayne')

			// THEN the field is gone, counted as a placeholder drop
			expect(enrichment(result.findings).location).toBeNull()
			expect(result.droppedPlaceholder).toBe(1)
		})

		it('should drop a value that is just the field name', () => {
			// GIVEN a value echoing its own key
			const findings = {
				enrichment: {
					industry: {
						value: 'industry',
						source_id: 'https://acme.es',
						confidence: 0.5,
					},
				},
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'acme sells shoes')

			// THEN dropped as a placeholder
			expect(enrichment(result.findings).industry).toBeNull()
			expect(result.droppedPlaceholder).toBe(1)
		})

		it('should drop generic non-answers like "unknown"', () => {
			// GIVEN a filled-but-empty value
			const findings = {
				enrichment: {
					size_range: {
						value: 'unknown',
						source_id: 'https://acme.es',
						confidence: null,
					},
				},
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'acme is a small firm')

			// THEN dropped
			expect(enrichment(result.findings).size_range).toBeNull()
			expect(result.droppedPlaceholder).toBe(1)
		})
	})

	describe('when a location names no place', () => {
		it('should drop a value that counts places instead of naming one', () => {
			// GIVEN the Grupo Sesé case: the extractor answered "where?" with a reach,
			// backed by a real quote so every other check passes it
			const findings = {
				enrichment: {
					location: {
						value: '15 countries throughout the world',
						source_id: 'https://gruposese.com',
						quote: 'present in 15 countries throughout the world',
						confidence: null,
					},
				},
			}

			// WHEN grounded against evidence that does contain the quote
			const result = guardScalarFields(
				findings,
				'grupo sese is present in 15 countries throughout the world',
			)

			// THEN it is dropped as the wrong kind of value, on its own counter
			expect(enrichment(result.findings).location).toBeNull()
			expect(result.droppedWrongKind).toBe(1)
			expect(result.droppedPlaceholder).toBe(0)
		})

		it('should drop a bare reach word', () => {
			// GIVEN "worldwide" as the whole location
			const findings = {
				enrichment: {
					location: {
						value: 'Worldwide',
						source_id: 'https://acme.com',
						quote: 'we operate worldwide',
						confidence: null,
					},
				},
			}

			// WHEN grounded — THEN dropped
			const result = guardScalarFields(findings, 'acme, we operate worldwide')
			expect(enrichment(result.findings).location).toBeNull()
			expect(result.droppedWrongKind).toBe(1)
		})

		it('should keep a real place, however many words it runs to', () => {
			// GIVEN a genuine multi-part location
			const findings = {
				enrichment: {
					location: {
						value: 'Sant Cugat del Vallès, Barcelona, Catalonia, Spain',
						source_id: 'https://acme.es',
						quote: 'based in Sant Cugat del Vallès, Barcelona',
						confidence: null,
					},
				},
			}

			// WHEN grounded — THEN kept, so a long address is not mistaken for a tally
			const result = guardScalarFields(
				findings,
				'acme is based in sant cugat del vallès, barcelona, catalonia, spain',
			)
			expect(enrichment(result.findings).location).not.toBeNull()
			expect(result.droppedWrongKind).toBe(0)
		})

		it('should keep a reach word that only prefixes a real place', () => {
			// GIVEN a value whose reach word is not the whole answer
			const findings = {
				enrichment: {
					location: {
						value: 'Worldwide HQ in Chicago',
						source_id: 'https://acme.com',
						quote: 'worldwide hq in chicago',
						confidence: null,
					},
				},
			}

			// WHEN grounded — THEN kept, since a place is named
			const result = guardScalarFields(findings, 'acme worldwide hq in chicago')
			expect(enrichment(result.findings).location).not.toBeNull()
			expect(result.droppedWrongKind).toBe(0)
		})

		it('should not judge the shape of a non-location field', () => {
			// GIVEN "worldwide" in the industry field, where it is not a place claim
			const findings = {
				enrichment: {
					industry: {
						value: 'worldwide',
						source_id: 'https://acme.com',
						quote: 'a worldwide logistics brand',
						confidence: null,
					},
				},
			}

			// WHEN grounded — THEN the location rule does not touch another field
			const result = guardScalarFields(
				findings,
				'acme is a worldwide logistics brand',
			)
			expect(result.droppedWrongKind).toBe(0)
		})
	})

	describe('when a field carries no fetched source', () => {
		it('should drop a bare value with no source_id', () => {
			// GIVEN the Redwood/ITS shape: a value with provenance but no source_id
			// (the citation guard strips a fabricated source to exactly this)
			const findings = {
				enrichment: {
					address: {
						value: '2811 West Carson Street, Suite 200, Pittsburgh, PA',
						confidence: null,
					},
				},
			}

			// WHEN grounded
			const result = guardScalarFields(
				findings,
				'redwood logistics is headquartered in chicago, illinois',
			)

			// THEN the unsourced fact is treated as absent
			expect(enrichment(result.findings).address).toBeNull()
			expect(result.droppedUngrounded).toBe(1)
		})

		it('should drop a value whose source_id is blank', () => {
			// GIVEN an empty-string source_id
			const findings = {
				enrichment: {
					country: { value: 'ES', source_id: '   ', confidence: 0.8 },
				},
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'based in catalonia, spain')

			// THEN dropped as ungrounded
			expect(enrichment(result.findings).country).toBeNull()
			expect(result.droppedUngrounded).toBe(1)
		})
	})

	describe('when a literal field quote does not back the value', () => {
		it('should drop the Sunset location whose quote never mentions it', () => {
			// GIVEN a location taken from the query, quoted with an unrelated snippet
			const findings = {
				enrichment: {
					location: {
						value: 'St. Louis, Missouri, USA',
						source_id: 'https://sunsettrans.com',
						quote: 'second generation Midwest roots',
						confidence: 0.3,
					},
				},
			}

			// WHEN grounded against a corpus that DOES contain the quote
			const result = guardScalarFields(
				findings,
				'a company with second generation midwest roots serving shippers',
			)

			// THEN the field is dropped: the quote is real but supports nothing
			expect(enrichment(result.findings).location).toBeNull()
			expect(result.droppedUnsupported).toBe(1)
		})

		it('should keep a location whose quote actually names it', () => {
			// GIVEN a grounded location whose quote contains the place
			const findings = {
				enrichment: {
					location: {
						value: 'Chicago, IL',
						source_id: 'https://redwood.com',
						quote: 'Redwood is headquartered in Chicago, Illinois',
						confidence: 0.9,
					},
				},
			}

			// WHEN grounded against a corpus containing the quote
			const result = guardScalarFields(
				findings,
				'redwood is headquartered in chicago, illinois since 2001',
			)

			// THEN it survives untouched
			expect(enrichment(result.findings).location).toEqual(
				findings.enrichment.location,
			)
			expect(result.droppedUnsupported).toBe(0)
		})
	})

	describe('when a quote is largely absent from the evidence', () => {
		it('should drop a field whose quote was invented', () => {
			// GIVEN a plausible value but a quote whose words appear nowhere fetched
			const findings = {
				enrichment: {
					current_tools: {
						value: 'SAP ERP',
						source_id: 'https://acme.es',
						quote:
							'we run our operations entirely on Oracle NetSuite and Salesforce',
						confidence: 0.8,
					},
				},
			}

			// WHEN grounded against a corpus that never mentions those tools
			const result = guardScalarFields(
				findings,
				'acme is a logistics firm serving european shippers',
			)

			// THEN the fabricated-quote field is dropped
			expect(enrichment(result.findings).current_tools).toBeNull()
			expect(result.droppedUnsupported).toBe(1)
		})
	})

	describe('when a field is paraphrased or coded, not verbatim', () => {
		it('should keep an industry whose quote paraphrases it', () => {
			// GIVEN industry (a non-literal field): the quote supports the category
			// without repeating the word, so a text-overlap test must NOT reject it
			const findings = {
				enrichment: {
					industry: {
						value: 'manufacturing',
						source_id: 'https://acme.es',
						quote: 'a leading manufacturer of industrial pumps',
						confidence: 0.9,
					},
				},
			}

			// WHEN grounded against a corpus containing the quote
			const result = guardScalarFields(
				findings,
				'acme is a leading manufacturer of industrial pumps in europe',
			)

			// THEN it survives — industry is not held to verbatim overlap
			expect(enrichment(result.findings).industry).toEqual(
				findings.enrichment.industry,
			)
			expect(result.droppedUnsupported).toBe(0)
		})

		it('should keep a size band whose quote gives a different but supporting number', () => {
			// GIVEN size_range (coded): value is a band, quote is a headcount
			const findings = {
				enrichment: {
					size_range: {
						value: '51-200',
						source_id: 'https://acme.es',
						quote: 'our team of 120 people',
						confidence: 0.7,
					},
				},
			}

			// WHEN grounded against a corpus containing the quote
			const result = guardScalarFields(findings, 'acme, our team of 120 people')

			// THEN kept — size is not a literal field
			expect(enrichment(result.findings).size_range).toEqual(
				findings.enrichment.size_range,
			)
		})

		it('should keep an everyday-word value that is a real industry, not a placeholder', () => {
			// GIVEN a software company: "software" is an everyday word but a genuine
			// industry value, so it must not be mistaken for a schema placeholder
			const findings = {
				enrichment: {
					industry: {
						value: 'software',
						source_id: 'https://acme.es',
						quote: 'Acme builds software for logistics teams',
						confidence: 0.9,
					},
				},
			}

			// WHEN grounded against a corpus containing the quote
			const result = guardScalarFields(
				findings,
				'acme builds software for logistics teams',
			)

			// THEN it survives
			expect(enrichment(result.findings).industry).toEqual(
				findings.enrichment.industry,
			)
			expect(result.droppedPlaceholder).toBe(0)
		})
	})

	describe('when the field is a contact channel', () => {
		it('should leave email and phone to the value guard', () => {
			// GIVEN an unsourced email + phone the value guard owns
			const findings = {
				contacts: [
					{
						name: 'Ada',
						email: { value: 'ada@acme.es', confidence: null },
						phone: { value: '+34 600 000 000', confidence: null },
					},
				],
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'contact ada@acme.es')

			// THEN neither channel is touched here (no source_id required of them)
			const contact = (
				result.findings as { contacts: Array<Record<string, unknown>> }
			).contacts[0]
			expect(contact?.['email']).toEqual({
				value: 'ada@acme.es',
				confidence: null,
			})
			expect(contact?.['phone']).toEqual({
				value: '+34 600 000 000',
				confidence: null,
			})
			expect(result.droppedUngrounded).toBe(0)
		})

		it('should still ground a contact role', () => {
			// GIVEN a role (not a channel) with no source
			const findings = {
				contacts: [{ name: 'Ada', role: { value: 'CEO', confidence: null } }],
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'ada is the ceo')

			// THEN the unsourced role is dropped
			const contact = (
				result.findings as { contacts: Array<Record<string, unknown>> }
			).contacts[0]
			expect(contact?.['role']).toBeNull()
			expect(result.droppedUngrounded).toBe(1)
		})
	})

	describe('when the shape holds subtrees that are not scalar fields', () => {
		it('should not walk into citations or proposed_updates', () => {
			// GIVEN a citation entry and a proposed-update blob that could look field-ish
			const findings = {
				enrichment: {},
				competitors: [
					{ name: 'Rival', citations: [{ source_id: 'x', quote: 'a rival' }] },
				],
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { value: 'headquarters' },
						citations: [{ source_id: 'x' }],
					},
				],
			}

			// WHEN grounded
			const result = guardScalarFields(findings, 'some evidence')

			// THEN those subtrees are untouched (no drops)
			expect(result.droppedPlaceholder).toBe(0)
			expect(result.droppedUngrounded).toBe(0)
			expect(result.droppedUnsupported).toBe(0)
			expect(
				(result.findings as { proposed_updates: unknown[] }).proposed_updates,
			).toEqual(findings.proposed_updates)
		})
	})

	describe('when no corpus is supplied', () => {
		it('should skip the quote-in-evidence check but still drop placeholders and unsourced values', () => {
			// GIVEN a grounded field with a quote, plus a placeholder, plus an unsourced one
			const findings = {
				enrichment: {
					industry: {
						value: 'retail',
						source_id: 'https://acme.es',
						quote: 'a shop we could not re-verify',
						confidence: 0.9,
					},
					location: {
						value: 'headquarters',
						source_id: 'https://acme.es',
						confidence: null,
					},
					country: { value: 'ES', confidence: 0.5 },
				},
			}

			// WHEN grounded with an empty corpus
			const result = guardScalarFields(findings, '')

			// THEN the quote check is skipped (industry kept) but the other rules still fire
			expect(enrichment(result.findings).industry).toEqual(
				findings.enrichment.industry,
			)
			expect(enrichment(result.findings).location).toBeNull()
			expect(enrichment(result.findings).country).toBeNull()
			expect(result.droppedPlaceholder).toBe(1)
			expect(result.droppedUngrounded).toBe(1)
			// AND each drop is recorded with its field, reason, value, and source, so
			// an empty field can be traced to why the guard nulled it
			expect(result.drops).toEqual([
				{
					field: 'location',
					reason: 'placeholder',
					value: 'headquarters',
					sourceId: 'https://acme.es',
				},
				{ field: 'country', reason: 'ungrounded', value: 'ES', sourceId: null },
			])
		})
	})
})
