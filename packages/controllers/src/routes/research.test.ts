import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { ContextInput } from './research'

// Decode through the canonical JSON codec so the check mirrors what the MCP tool
// and HTTP route actually run on a caller's payload.
const decode = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
): S['Type'] => Schema.decodeUnknownSync(Schema.toCodecJson(schema))(input)

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(Schema.toCodecJson(schema))(input)

describe('ContextInput', () => {
	describe('when the selector is well formed', () => {
		it('should accept a selector wrapped in table + filter', () => {
			// GIVEN the documented selector shape
			// WHEN decode runs
			// THEN it succeeds and keeps the filter fields
			const out = decode(ContextInput, {
				selector: {
					table: 'companies',
					filter: { country: 'US', status: 'prospect' },
				},
			})
			expect(out.selector?.table).toBe('companies')
			expect(out.selector?.filter.country).toBe('US')
		})

		it('should accept an empty filter (matches every company)', () => {
			// GIVEN a selector with an empty filter
			// WHEN decode runs
			// THEN it succeeds — an unfiltered fan-out is still bounded downstream by
			// the confirm gate and the company cap
			const out = decode(ContextInput, {
				selector: { table: 'companies', filter: {} },
			})
			expect(out.selector?.filter).toEqual({})
		})
	})

	describe('when the context carries no selector', () => {
		it('should accept subjects and hints', () => {
			// GIVEN a subjects+hints context and no selector
			// WHEN decode runs
			// THEN it succeeds
			const out = decode(ContextInput, {
				subjects: [{ table: 'companies', id: 'abc' }],
				hints: { language: 'en', country: 'US', place: 'Dallas, TX' },
			})
			expect(out.subjects?.[0]?.id).toBe('abc')
			expect(out.hints?.country).toBe('US')
			expect(out.hints?.place).toBe('Dallas, TX')
		})

		it('should accept an empty context', () => {
			// GIVEN a bare object
			// WHEN decode runs
			// THEN it succeeds with everything absent
			const out = decode(ContextInput, {})
			expect(out.selector).toBeUndefined()
		})
	})

	describe('when the selector is malformed (the shapes reported in #303)', () => {
		// Each of these reached the engine unchecked and crashed on
		// `selector.filter.status`; decoding must reject them up front instead.
		it('should reject filter fields placed directly under selector', () => {
			// GIVEN { selector: { country, industry, status } } — no table, no filter
			const exit = decodeExit(ContextInput, {
				selector: {
					country: 'US',
					industry: 'Freight brokerage',
					status: 'prospect',
				},
			})
			expect(exit._tag).toBe('Failure')
		})

		it('should reject a `filters` key instead of `filter`', () => {
			// GIVEN { selector: { filters: {...} } } — misnamed and missing table
			const exit = decodeExit(ContextInput, {
				selector: { filters: { country: 'US', status: 'prospect' } },
			})
			expect(exit._tag).toBe('Failure')
		})

		it('should reject a `subject_table` selector', () => {
			// GIVEN { selector: { subject_table, status, country } } — no table/filter
			const exit = decodeExit(ContextInput, {
				selector: {
					subject_table: 'companies',
					status: 'prospect',
					country: 'US',
				},
			})
			expect(exit._tag).toBe('Failure')
		})

		it('should reject a non-companies selector table', () => {
			// GIVEN a selector aimed at contacts (only companies fan out)
			const exit = decodeExit(ContextInput, {
				selector: { table: 'contacts', filter: {} },
			})
			expect(exit._tag).toBe('Failure')
		})
	})
})
