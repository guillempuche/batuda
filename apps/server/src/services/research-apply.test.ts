import { describe, expect, it } from 'vitest'

import { allowlistFields, validate } from './research-apply'

describe('allowlistFields', () => {
	describe('when a company proposal carries writable and non-writable keys', () => {
		it('should keep only known columns and drop everything else', () => {
			// GIVEN a proposal mixing real company columns with fields that must
			// never be written from a suggestion (identity, coordinates, version)
			const kept = allowlistFields('companies', {
				industry: 'logistics',
				location: 'Sitges',
				id: 'should-drop',
				latitude: 1.23,
				version: 99,
				made_up: 'nope',
			})

			// THEN only the writable columns survive
			expect(kept).toEqual({ industry: 'logistics', location: 'Sitges' })
		})
	})

	describe('when proposal keys are snake_case', () => {
		it('should normalize them to the camelCase the SQL client expects', () => {
			// GIVEN a model that sent snake_case field names
			const kept = allowlistFields('companies', {
				size_range: '51-200',
				pain_points: 'slow onboarding',
			})

			// THEN they map to the camelCase column keys
			expect(kept).toEqual({
				sizeRange: '51-200',
				painPoints: 'slow onboarding',
			})
		})
	})

	describe('when the target is a contact', () => {
		it('should use the contact allowlist, not the company one', () => {
			// GIVEN a contact proposal that also carries a company-only field
			const kept = allowlistFields('contacts', {
				is_decision_maker: true,
				notes: 'met at fair',
				industry: 'company-only, should drop',
			})

			// THEN only contact columns survive
			expect(kept).toEqual({ isDecisionMaker: true, notes: 'met at fair' })
		})
	})
})

describe('validate', () => {
	const base = {
		subject_table: 'companies',
		subject_id: 'c-1',
		expected_version: 2,
		fields: { industry: 'logistics' },
	}

	describe('when the proposal is well-formed', () => {
		it('should accept it and surface the parsed parts', () => {
			// GIVEN a complete, well-typed proposal
			const result = validate(base)

			// THEN it validates and exposes the target and fields
			expect(result).toMatchObject({
				ok: true,
				table: 'companies',
				subjectId: 'c-1',
				expectedVersion: 2,
			})
		})
	})

	describe('when the subject table is not a CRM table', () => {
		it('should reject it', () => {
			// GIVEN a proposal targeting an unknown table
			expect(validate({ ...base, subject_table: 'invoices' }).ok).toBe(false)
		})
	})

	describe('when the expected version is not a finite number', () => {
		it('should reject it (a "NaN" the guard coerced to null cannot drive OCC)', () => {
			// GIVEN a proposal whose expected version was coerced away
			expect(validate({ ...base, expected_version: null }).ok).toBe(false)
			expect(validate({ ...base, expected_version: Number.NaN }).ok).toBe(false)
		})
	})

	describe('when fields is prose instead of an object', () => {
		it('should reject it, since a sentence is not an actionable field map', () => {
			// GIVEN the tolerant-decoder fallback: the model wrote a sentence where
			// a JSON object was expected, kept verbatim as a string
			expect(
				validate({ ...base, fields: 'set the industry to logistics' }).ok,
			).toBe(false)
			// GIVEN an array, which is also not a field map
			expect(validate({ ...base, fields: ['industry'] }).ok).toBe(false)
		})
	})
})
