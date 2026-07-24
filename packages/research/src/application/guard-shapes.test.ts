import { describe, expect, it } from 'vitest'

import {
	isCitedField,
	isPlainObject,
	isSourcedField,
	isValueWrapper,
} from './guard-shapes'

describe('isPlainObject', () => {
	describe('when given something to walk into', () => {
		it('should accept only a non-null, non-array object', () => {
			// GIVEN the shapes a findings walk meets
			expect(isPlainObject({ a: 1 })).toBe(true)
			expect(isPlainObject([])).toBe(false)
			expect(isPlainObject(null)).toBe(false)
			expect(isPlainObject('x')).toBe(false)
			expect(isPlainObject(undefined)).toBe(false)
		})
	})
})

// The three value tests answer different questions, and the guards depend on the
// difference. These cases pin that difference so they are never collapsed.
describe('the value-shape tests, on the object that separates them', () => {
	describe('when an object carries a value but no provenance at all', () => {
		it('should be a value wrapper only — not sourced, not cited', () => {
			// GIVEN a bare { value } — an arbitrary object, not a real per-field wrapper
			const bare = { value: 'transport' }
			expect(isValueWrapper(bare)).toBe(true)
			expect(isSourcedField(bare)).toBe(false)
			expect(isCitedField(bare)).toBe(false)
		})
	})

	describe('when an object has a value and a quote but no source id', () => {
		it('should be sourced but not cited', () => {
			// GIVEN provenance that cannot be resolved back to a source
			const quoted = { value: '51-200', quote: 'we are 120 people' }
			expect(isValueWrapper(quoted)).toBe(true)
			expect(isSourcedField(quoted)).toBe(true)
			expect(isCitedField(quoted)).toBe(false)
		})
	})

	describe('when an object has a value and a string source id', () => {
		it('should satisfy all three', () => {
			// GIVEN a fully resolvable per-field wrapper
			const cited = { value: 'transport', source_id: 'https://acme.es/about' }
			expect(isValueWrapper(cited)).toBe(true)
			expect(isSourcedField(cited)).toBe(true)
			expect(isCitedField(cited)).toBe(true)
		})
	})

	describe('when the source id is present but not a string', () => {
		it('should be sourced but not cited — the citation is unusable', () => {
			// GIVEN a malformed id the guard could not resolve
			const malformed = { value: 'transport', source_id: 42 }
			expect(isSourcedField(malformed)).toBe(true)
			expect(isCitedField(malformed)).toBe(false)
		})
	})

	describe('when there is no value at all', () => {
		it('should satisfy none of them (a bare citation is not a field)', () => {
			// GIVEN a block-level citation, which carries a source but no value
			const citation = { source_id: 'https://acme.es/about', quote: 'hello' }
			expect(isValueWrapper(citation)).toBe(false)
			expect(isSourcedField(citation)).toBe(false)
			expect(isCitedField(citation)).toBe(false)
		})
	})
})
