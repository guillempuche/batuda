import { describe, expect, it } from 'vitest'

import { allowlistFields, validate, validateCreate } from './research-apply'

describe('allowlistFields', () => {
	describe('when a company proposal carries writable and non-writable keys', () => {
		it('should keep only known columns and drop everything else', () => {
			// GIVEN a proposal mixing real company columns with fields that must
			// never be written from a suggestion (identity, coordinates, version, and
			// country — country is stamped from the run's own resolved country, never
			// taken from the model's per-field suggestions)
			const { fields: kept } = allowlistFields('companies', {
				industry: 'logistics',
				location: 'Sitges',
				country: 'US',
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
			const { fields: kept } = allowlistFields('companies', {
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
			const { fields: kept } = allowlistFields('contacts', {
				is_decision_maker: true,
				notes: 'met at fair',
				industry: 'company-only, should drop',
			})

			// THEN only contact columns survive
			expect(kept).toEqual({ isDecisionMaker: true, notes: 'met at fair' })
		})
	})

	describe('when a value arrives wrapped with the page it came from', () => {
		it('should write the plain value and keep its citation beside it', () => {
			// GIVEN one sourced value and one bare one
			const { fields, citations } = allowlistFields('companies', {
				industry: {
					value: 'transport',
					source_id: 'src-acme-about',
					confidence: 0.9,
					as_of: '2026-07-01',
				},
				location: 'Sitges',
			})

			// THEN the column gets the value, and the cited page is kept under it
			expect(fields).toEqual({ industry: 'transport', location: 'Sitges' })
			expect(citations).toEqual({
				industry: {
					sourceId: 'src-acme-about',
					confidence: 0.9,
					asOf: '2026-07-01',
				},
			})
		})
	})

	describe('when a wrapped value names no usable page', () => {
		it('should still write the value, with nothing claimed about its source', () => {
			// GIVEN a wrapper whose source id is empty
			const { fields, citations } = allowlistFields('companies', {
				industry: { value: 'transport', source_id: '' },
			})

			// THEN the value lands and no source is invented for it
			expect(fields).toEqual({ industry: 'transport' })
			expect(citations).toEqual({})
		})
	})

	describe('when a dropped field carries a source', () => {
		it('should record no source for it, since nothing was written', () => {
			// GIVEN a non-writable column arriving with provenance
			const { fields, citations } = allowlistFields('companies', {
				id: { value: 'nope', source_id: 'https://acme.es' },
			})

			// THEN neither the value nor its source survives
			expect(fields).toEqual({})
			expect(citations).toEqual({})
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

describe('validateCreate', () => {
	const base = {
		operation: 'create',
		subject_table: 'contacts',
		fields: {
			name: 'Ada Lovelace',
			company_id: 'co-1',
			role: 'CTO',
			is_decision_maker: true,
			industry: 'company-only, should drop',
			channels: [
				{
					kind: 'email',
					value: 'ada@acme.es',
					verification: 'valid',
					confidence: 90,
					is_primary: true,
				},
				// Malformed — a channel with no value is not reachable, so dropped
				{ kind: 'phone' },
			],
		},
	}

	describe('when a discovered contact is well-formed', () => {
		it('should accept it, keep only contact columns, and parse the channels', () => {
			// GIVEN a discovered contact carrying company-only and identity keys too
			const result = validateCreate(base)

			// THEN it validates, exposing the company link, the contact columns, and
			// the reachable channels only
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.companyId).toBe('co-1')
			expect(result.fields).toEqual({
				name: 'Ada Lovelace',
				role: 'CTO',
				isDecisionMaker: true,
			})
			expect(result.channels).toEqual([
				{
					kind: 'email',
					value: 'ada@acme.es',
					verification: 'valid',
					confidence: 90,
					is_primary: true,
				},
			])
		})
	})

	describe('when the target is not a contact', () => {
		it('should reject it — create is contacts-only', () => {
			expect(validateCreate({ ...base, subject_table: 'companies' }).ok).toBe(
				false,
			)
		})
	})

	describe('when the name is missing or blank', () => {
		it('should reject it', () => {
			expect(
				validateCreate({ ...base, fields: { company_id: 'co-1' } }).ok,
			).toBe(false)
			expect(
				validateCreate({ ...base, fields: { name: '   ', company_id: 'co-1' } })
					.ok,
			).toBe(false)
		})
	})

	describe('when the company_id is missing', () => {
		it('should reject it, since contacts.company_id is required', () => {
			expect(validateCreate({ ...base, fields: { name: 'Ada' } }).ok).toBe(
				false,
			)
		})
	})

	describe('when the contact has no channels', () => {
		it('should accept it with an empty channel list', () => {
			const result = validateCreate({
				...base,
				fields: { name: 'Ada', company_id: 'co-1' },
			})
			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.channels).toEqual([])
		})
	})
})
