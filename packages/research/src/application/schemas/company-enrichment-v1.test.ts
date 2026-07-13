import { Schema } from 'effect'
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
})
