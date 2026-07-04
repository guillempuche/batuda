import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CompanyEnrichmentV1Schema } from './company-enrichment-v1'

const decode = Schema.decodeUnknownSync(CompanyEnrichmentV1Schema)

describe('CompanyEnrichmentV1Schema', () => {
	describe('when decoding an enrichment payload with the location in words but no coordinates', () => {
		it('should decode and expose no latitude or longitude', () => {
			// GIVEN a model result shaped like a real enrichment: the location is
			// described in words, and coordinates are absent (their real source is
			// the deterministic geocoder, not the model)
			const payload = {
				enrichment: {
					industry: 'Freight & logistics',
					size_range: '51-200',
					location: 'St. Louis, MO',
					region: 'United States',
					citations: [{ source_id: 'src-1' }],
				},
			}

			// WHEN it is decoded against the schema
			const decoded = decode(payload)

			// THEN it succeeds, keeps the textual location, and carries no
			// coordinate fields at all
			expect(decoded.enrichment.location).toBe('St. Louis, MO')
			expect(decoded.enrichment).not.toHaveProperty('latitude')
			expect(decoded.enrichment).not.toHaveProperty('longitude')
		})
	})

	describe('when the model emits "NaN" for coordinates it could not determine', () => {
		it('should decode without error instead of failing the run', () => {
			// GIVEN the exact shape that failed in production: unable to produce
			// real coordinates, the model filled both fields with the string "NaN"
			const payload = {
				enrichment: {
					industry: 'Freight & logistics',
					location: 'St. Louis, MO',
					latitude: 'NaN',
					longitude: 'NaN',
					citations: [{ source_id: 'src-1' }],
				},
			}

			// WHEN it is decoded
			// THEN decode does not throw — the coordinate keys are no longer part of
			// the schema, so a stray value is ignored rather than rejected, and an
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
					location: 'St. Louis, MO',
					latitude: 38.627,
					longitude: -90.199,
					citations: [{ source_id: 'src-1' }],
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
