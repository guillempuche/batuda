import { describe, expect, it } from 'vitest'

import {
	allowlistFields,
	checkCompanyFieldValues,
	validate,
	validateCreate,
} from './research-apply'

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
				current_tools: 'a spreadsheet',
			})

			// THEN they map to the camelCase column keys
			expect(kept).toEqual({
				sizeRange: '51-200',
				currentTools: 'a spreadsheet',
			})
		})
	})

	describe('when the target is a contact', () => {
		it('should use the contact allowlist, not the company one', () => {
			// GIVEN a contact proposal that also carries a company-only field
			const { fields: kept } = allowlistFields('contacts', {
				buying_role: 'economic_buyer',
				role: 'Head of operations',
				industry: 'company-only, should drop',
			})

			// THEN only contact columns survive
			expect(kept).toEqual({
				buyingRole: 'economic_buyer',
				role: 'Head of operations',
			})
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
			buying_role: 'economic_buyer',
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
				buyingRole: 'economic_buyer',
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

describe('checkCompanyFieldValues', () => {
	describe('when every constrained value is one the column accepts', () => {
		it('should report nothing to reject', () => {
			// GIVEN a proposal whose status, priority and size all come from the
			// vocabularies the database constrains those columns to
			const reason = checkCompanyFieldValues({
				status: 'contacted',
				priority: 2,
				sizeRange: '51-200',
				industry: 'logistics',
			})

			// THEN it is applicable
			expect(reason).toBeNull()
		})
	})

	describe('when the proposal mentions none of the constrained fields', () => {
		it('should report nothing to reject', () => {
			// GIVEN a proposal touching only free-text columns
			const reason = checkCompanyFieldValues({
				industry: 'logistics',
				location: 'Sitges',
			})

			// THEN there is nothing to check
			expect(reason).toBeNull()
		})
	})

	describe('when the model invents a status outside the vocabulary', () => {
		it('should reject it and name both the field and the value', () => {
			// GIVEN a status from an older vocabulary the app no longer has
			const reason = checkCompanyFieldValues({ status: 'qualified' })

			// THEN the proposal is refused, and the message says what was wrong so a
			// reviewer is not left with a bare failure
			expect(reason).not.toBeNull()
			expect(reason).toContain('status')
			expect(reason).toContain('qualified')
		})
	})

	describe('when a priority falls outside the allowed range', () => {
		it('should reject it', () => {
			// GIVEN a priority from the old 1-5 scale, which is now 1-3
			expect(checkCompanyFieldValues({ priority: 5 })).not.toBeNull()
		})
	})

	describe('when a size range is not one of the bands', () => {
		it('should reject it', () => {
			// GIVEN a band the model made up rather than one of COMPANY_SIZE_RANGES
			expect(checkCompanyFieldValues({ sizeRange: '20-30' })).not.toBeNull()
		})
	})

	describe('when a nullable column is explicitly cleared', () => {
		it('should allow it, since null is how a value is removed', () => {
			// GIVEN a proposal clearing the two columns the database lets be null
			expect(checkCompanyFieldValues({ priority: null })).toBeNull()
			expect(checkCompanyFieldValues({ sizeRange: null })).toBeNull()
		})
	})

	describe('when status is cleared', () => {
		it('should reject it, since the column is NOT NULL', () => {
			// GIVEN a proposal trying to empty a column that always holds a stage
			expect(checkCompanyFieldValues({ status: null })).not.toBeNull()
		})
	})

	describe('when a value carries the right vocabulary but the wrong type', () => {
		it('should reject it rather than coerce', () => {
			// GIVEN a priority sent as text and a status sent as a number — the
			// database compares by type, so neither would match its constraint
			expect(checkCompanyFieldValues({ priority: '2' })).not.toBeNull()
			expect(checkCompanyFieldValues({ status: 1 })).not.toBeNull()
		})
	})

	describe('when several fields are wrong at once', () => {
		it('should report the first one, since the whole proposal goes back', () => {
			// GIVEN a proposal with two unusable values
			const reason = checkCompanyFieldValues({
				status: 'lead',
				priority: 9,
			})

			// THEN one clear reason comes back rather than a merged list
			expect(reason).toContain('status')
		})
	})
})

describe('allowlistFields feeding checkCompanyFieldValues', () => {
	describe('when a bad value arrives wrapped with the page it came from', () => {
		it('should still be caught, since the wrapper is unwrapped first', () => {
			// GIVEN an enrichment finding carrying its provenance envelope, which is
			// the shape the apply path unwraps before any value is checked
			const { fields } = allowlistFields('companies', {
				status: { value: 'negotiation', source_id: 'src-1' },
			})

			// THEN the value inside the wrapper is the one judged
			expect(fields['status']).toBe('negotiation')
			expect(checkCompanyFieldValues(fields)).not.toBeNull()
		})
	})

	describe('when a good value arrives wrapped', () => {
		it('should pass, so provenance does not make a valid value unusable', () => {
			// GIVEN the same envelope around a stage that is in the vocabulary
			const { fields } = allowlistFields('companies', {
				status: { value: 'meeting', source_id: 'src-1' },
			})

			// THEN nothing is rejected
			expect(checkCompanyFieldValues(fields)).toBeNull()
		})
	})

	describe('when a snake_case key carries a bad value', () => {
		it('should be caught under its camelCase column name', () => {
			// GIVEN the model writing size_range, which the allowlist renames
			const { fields } = allowlistFields('companies', { size_range: '2-7' })

			// THEN the renamed field is the one checked
			expect(checkCompanyFieldValues(fields)).toContain('sizeRange')
		})
	})
})
