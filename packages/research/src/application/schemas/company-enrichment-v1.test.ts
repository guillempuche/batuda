import { Schema } from 'effect'
import { OpenAiStructuredOutput } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { CompanyEnrichmentV1Schema } from './company-enrichment-v1'

const decode = Schema.decodeUnknownSync(CompanyEnrichmentV1Schema)

describe('CompanyEnrichmentV1Schema', () => {
	describe('when decoding an enrichment payload with per-field sources', () => {
		it('should decode each field to its value paired with a source', () => {
			// GIVEN a model result shaped like a real enrichment: every scalar field
			// carries its own value plus the source that backs it (industry from one
			// page, country from another), instead of one citation list for the block
			const payload = {
				enrichment: {
					industry: {
						value: 'Freight & logistics',
						source_id: 'src-1',
						confidence: null,
					},
					size_range: { value: '51-200', source_id: 'src-1', confidence: null },
					location: {
						value: 'St. Louis, MO',
						source_id: 'src-1',
						confidence: null,
					},
					country: {
						value: 'US',
						source_id: 'src-2',
						confidence: null,
					},
				},
				contacts: [
					{
						name: 'Ada Lovelace',
						role: { value: 'CTO', source_id: 'src-1', confidence: null },
						email: {
							value: 'ada@acme.es',
							source_id: 'src-1',
							confidence: null,
						},
						phone: {
							value: '+34 900 000 000',
							source_id: 'src-2',
							confidence: null,
						},
						citations: [
							{
								source_id: 'src-1',
								quote: 'Ada Lovelace, CTO',
								confidence: null,
							},
						],
					},
				],
			}

			// WHEN it is decoded against the schema
			const decoded = decode(payload)

			// THEN each field exposes its value alongside the citing source
			expect(decoded.enrichment.location?.value).toBe('St. Louis, MO')
			expect(decoded.enrichment.location?.source_id).toBe('src-1')
			expect(decoded.enrichment.industry?.value).toBe('Freight & logistics')
			expect(decoded.enrichment.country?.value).toBe('US')
			expect(decoded.enrichment.country?.source_id).toBe('src-2')
			expect(decoded.contacts?.[0]?.email?.value).toBe('ada@acme.es')
			expect(decoded.contacts?.[0]?.role?.value).toBe('CTO')
			// The per-contact citation ties the person to the company's own page.
			expect(decoded.contacts?.[0]?.citations?.[0]?.source_id).toBe('src-1')
		})
	})

	describe('when the model emits a fit verdict', () => {
		it('should decode the verdict, disqualifiers and per-criterion checks', () => {
			// GIVEN a "no fit" result of the kind that used to appear only in the brief
			// and was lost from the structured output
			const payload = {
				enrichment: {
					industry: {
						value: 'Freight & logistics',
						source_id: 'src-1',
						confidence: null,
					},
				},
				verdict: 'no_fit',
				verdict_rationale:
					'Holds a valid brokerage authority but operates 100% asset-based.',
				disqualifiers: [
					{
						rule: 'asset-based carrier, not a freight broker',
						evidence_quote: 'our fleet of 40 trucks',
						source_id: 'src-1',
					},
				],
				fit_checks: [
					{
						criterion: 'freight broker, not asset carrier',
						result: 'fail',
						evidence_quote: 'our fleet of 40 trucks',
						source_id: 'src-1',
					},
					{ criterion: 'US-based operations', result: 'pass' },
				],
			}

			// WHEN it is decoded
			const decoded = decode(payload)

			// THEN the judgement survives in the structured output
			expect(decoded.verdict).toBe('no_fit')
			expect(decoded.disqualifiers?.[0]?.rule).toBe(
				'asset-based carrier, not a freight broker',
			)
			expect(decoded.disqualifiers?.[0]?.source_id).toBe('src-1')
			expect(decoded.fit_checks?.[0]?.result).toBe('fail')
			expect(decoded.fit_checks?.[1]?.result).toBe('pass')
		})

		it('should reject a verdict outside the fixed set', () => {
			// GIVEN a verdict the schema does not define
			const payload = { enrichment: {}, verdict: 'maybe' }
			// WHEN decoded
			// THEN it fails rather than storing a free-text judgement
			expect(() => decode(payload)).toThrow()
		})
	})

	describe('when the sources disagree on a field', () => {
		it('should decode each losing reading with the page that stated it', () => {
			// GIVEN a head-count the sources disagree on — one entry per reading the
			// field did not take, each tied to the page that stated it
			const payload = {
				enrichment: {
					size_range: { value: '51-200', source_id: 'src-1', confidence: null },
				},
				conflicts: [
					{
						field: 'size_range',
						value: '11-50',
						source_id: 'https://indeed.com/cmp/acme',
						note: 'Older snapshot than the careers page',
					},
					{
						field: 'size_range',
						value: '201-500',
						source_id: 'https://www.zoominfo.com/c/acme/1',
					},
				],
			}

			// WHEN it is decoded
			const decoded = decode(payload)

			// THEN each reading keeps its value and source so the UI can link them
			expect(decoded.conflicts?.[0]?.field).toBe('size_range')
			expect(decoded.conflicts?.[0]?.value).toBe('11-50')
			expect(decoded.conflicts?.[0]?.source_id).toBe(
				'https://indeed.com/cmp/acme',
			)
			expect(decoded.conflicts?.[1]?.value).toBe('201-500')
		})
	})

	describe('when the model emits "NaN" for coordinates it could not determine', () => {
		it('should decode without error instead of failing the run', () => {
			// GIVEN the exact shape that failed in production: unable to produce
			// real coordinates, the model filled both fields with the string "NaN"
			const payload = {
				enrichment: {
					industry: {
						value: 'Freight & logistics',
						source_id: 'src-1',
						confidence: null,
					},
					location: {
						value: 'St. Louis, MO',
						source_id: 'src-1',
						confidence: null,
					},
					latitude: 'NaN',
					longitude: 'NaN',
				},
			}

			// WHEN it is decoded
			// THEN decode does not throw — the coordinate keys are not part of the
			// schema, so a stray value is ignored rather than rejected, and an
			// unlocatable company no longer blocks the whole extraction
			expect(() => decode(payload)).not.toThrow()
			expect(decode(payload).enrichment).not.toHaveProperty('latitude')
		})
	})

	describe('when the model emits real-looking numeric coordinates', () => {
		it('should still drop them so coordinates are never model-sourced', () => {
			// GIVEN a payload where the model guessed plausible-looking numbers
			const payload = {
				enrichment: {
					location: {
						value: 'St. Louis, MO',
						source_id: 'src-1',
						confidence: null,
					},
					latitude: 38.627,
					longitude: -90.199,
				},
			}

			// WHEN it is decoded
			const decoded = decode(payload)

			// THEN even a valid-looking coordinate is discarded — the model is never
			// trusted as a coordinate source, whatever it emits
			expect(decoded.enrichment).not.toHaveProperty('latitude')
			expect(decoded.enrichment).not.toHaveProperty('longitude')
		})
	})

	describe('when the model fills nothing, through the real provider codec', () => {
		it('should decode to an empty enrichment, which is why an empty answer needs its own counter', () => {
			// GIVEN a model that answered null for every profile field — the schema
			// forces all keys present, so "nothing" arrives as all-null, decoded the
			// way production decodes it (not the raw schema, which rejects null)
			const { codec } = OpenAiStructuredOutput.toCodecOpenAI(
				CompanyEnrichmentV1Schema,
			)
			const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(codec))
			const allNull = {
				enrichment: {
					industry: null,
					size_range: null,
					current_tools: null,
					tags: null,
					location: null,
					country: null,
				},
				competitors: null,
				contacts: null,
				discovered_existing: null,
				proposed_updates: null,
				pending_paid_actions: null,
			}

			// WHEN it is decoded through the codec
			const decoded = decodeJson(JSON.stringify(allNull)) as {
				enrichment: Record<string, unknown>
			}

			// THEN every null key is stripped and the enrichment is empty — not a lost
			// write but a faithful decode of "the model said nothing", the failure the
			// fill counters exist to make visible
			expect(Object.keys(decoded.enrichment)).toHaveLength(0)
		})
	})
})
