import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { schemaNames } from '@batuda/research/application/schemas'

import { ContextInput, CreateResearchInput } from './research'

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
				hints: { language: 'en', location: 'Dallas, TX' },
			})
			expect(out.subjects?.[0]?.id).toBe('abc')
			expect(out.hints?.location).toBe('Dallas, TX')
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

describe('CreateResearchInput', () => {
	describe('when schema_name is one the server can resolve', () => {
		it('should accept every name the registry holds', () => {
			// GIVEN each shape a run can be asked to come back in
			// WHEN decode runs
			// THEN none of them is turned away at the door
			for (const name of schemaNames) {
				const exit = decodeExit(CreateResearchInput, {
					query: 'who are their competitors',
					schema_name: name,
				})
				expect(exit._tag).toBe('Success')
			}
		})

		it('should accept a request that names no schema at all', () => {
			// GIVEN schema_name left out, which the service reads as freeform
			const exit = decodeExit(CreateResearchInput, { query: 'a question' })
			expect(exit._tag).toBe('Success')
		})
	})

	describe('when schema_name is not one the server can resolve', () => {
		it('should refuse it, so no run row is written for a doomed request', () => {
			// GIVEN a name the registry does not hold. Decoding is what the route
			// runs before the handler, so refusing here is refusing before the run
			// exists — rather than after it has flipped to running and said so.
			const exit = decodeExit(CreateResearchInput, {
				query: 'a question',
				schema_name: 'bogus_schema_v9',
			})
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse a fan-out too, so one bad name creates no runs', () => {
			// GIVEN a selector, which would otherwise write a batch row plus one run
			// per matched company before any of them reached the point of failing
			const exit = decodeExit(CreateResearchInput, {
				query: 'find me freight brokers',
				schema_name: 'prospect_scan_v2',
				context: {
					selector: { table: 'companies', filter: { country: 'US' } },
				},
			})
			expect(exit._tag).toBe('Failure')
		})

		it('should refuse an empty name rather than read it as freeform', () => {
			const exit = decodeExit(CreateResearchInput, {
				query: 'a question',
				schema_name: '',
			})
			expect(exit._tag).toBe('Failure')
		})
	})
})
