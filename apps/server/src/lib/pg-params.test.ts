import { PgTypes } from '@effect/sql-pg'
import { describe, expect, it } from 'vitest'

import { jsonColumn, textArray, withJsonColumns } from './pg-params'

describe('textArray', () => {
	describe('when the list is empty', () => {
		it('should still name its type, so the driver can bind it', () => {
			// GIVEN a caller clearing a list column
			// WHEN the empty list is turned into a parameter
			const parameter = textArray([])

			// THEN it is a typed text[] parameter holding nothing, rather than a
			// bare array the driver refuses for having no element to infer from
			expect(PgTypes.isParameter(parameter)).toBe(true)
			expect(parameter.oid).toBe(PgTypes.arrayOidFor(PgTypes.OID.text))
			expect(parameter.value).toEqual([])
		})
	})

	describe('when the list holds words', () => {
		it('should carry them unchanged', () => {
			// GIVEN two tags
			// WHEN they are turned into a parameter
			// THEN the words travel as they are
			expect(textArray(['a', 'b']).value).toEqual(['a', 'b'])
		})
	})
})

describe('jsonColumn', () => {
	describe('when there is no value', () => {
		it('should send NULL for null and for a missing value alike', () => {
			// GIVEN a column the caller cleared, and one it never named
			// WHEN each is prepared for a JSON column
			// THEN both are NULL, not the JSON text "null"
			expect(jsonColumn(null)).toBeNull()
			expect(jsonColumn(undefined)).toBeNull()
		})
	})

	describe('when there is a value', () => {
		it('should send it as JSON text, whatever its shape', () => {
			// GIVEN an object, a list and a number
			// WHEN each is prepared for a JSON column
			// THEN each is its JSON text, which the column parses back to the same
			// value — a bare object or number would be refused by the driver
			expect(jsonColumn({ a: 1 })).toBe('{"a":1}')
			expect(jsonColumn([1, 2])).toBe('[1,2]')
			expect(jsonColumn(5)).toBe('5')
		})

		it('should pass a string through as the JSON text it already is', () => {
			// GIVEN line items a client sent already written as JSON
			// WHEN they are prepared for a JSON column
			// THEN they go as they are, so the column holds the list rather than
			// one string spelling it out
			expect(jsonColumn('[{"qty":1}]')).toBe('[{"qty":1}]')
		})
	})
})

describe('withJsonColumns', () => {
	describe('when the row names a JSON column', () => {
		it('should turn only that column into JSON text', () => {
			// GIVEN a row with a JSON column beside an ordinary one
			// WHEN the JSON column is named
			const row = withJsonColumns({ title: 't', meta: { a: 1 } }, ['meta'])

			// THEN the JSON column is text and the other is left alone
			expect(row).toEqual({ title: 't', meta: '{"a":1}' })
		})
	})

	describe('when the row leaves a named column out', () => {
		it('should keep it absent, so an update leaves that column alone', () => {
			// GIVEN a partial update that does not mention the JSON column
			// WHEN the column is named
			const row = withJsonColumns<Record<string, unknown>>({ title: 't' }, [
				'meta',
			])

			// THEN no key is added, rather than one set to NULL that would wipe it
			expect('meta' in row).toBe(false)
		})
	})
})
