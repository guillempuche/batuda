import { describe, expect, it } from 'vitest'

import { fingerprintTemplates } from './fingerprint'

describe('fingerprintTemplates', () => {
	describe('when the same templates resolve in the same order', () => {
		it('should produce a stable fingerprint so an unchanged stack keeps hitting the cache', () => {
			// GIVEN two identical ordered resolutions [fingerprint.ts:13]
			const a = fingerprintTemplates([
				{ id: 't1', updatedAt: '100' },
				{ id: 't2', updatedAt: '200' },
			])
			const b = fingerprintTemplates([
				{ id: 't1', updatedAt: '100' },
				{ id: 't2', updatedAt: '200' },
			])
			// THEN they fingerprint identically
			expect(a).toBe(b)
		})
	})

	describe('when a template is edited', () => {
		it('should change the fingerprint so the edited template never serves a stale run', () => {
			// GIVEN the same template id with a bumped updated_at [fingerprint.ts:13]
			const before = fingerprintTemplates([{ id: 't1', updatedAt: '100' }])
			const after = fingerprintTemplates([{ id: 't1', updatedAt: '101' }])
			// THEN the fingerprint changes
			expect(after).not.toBe(before)
		})
	})

	describe('when the stack is reordered', () => {
		it('should change the fingerprint because order changes the assembled prompt', () => {
			// GIVEN the same two templates in opposite orders [fingerprint.ts:13]
			const ab = fingerprintTemplates([
				{ id: 't1', updatedAt: '100' },
				{ id: 't2', updatedAt: '200' },
			])
			const ba = fingerprintTemplates([
				{ id: 't2', updatedAt: '200' },
				{ id: 't1', updatedAt: '100' },
			])
			// THEN order is significant
			expect(ab).not.toBe(ba)
		})
	})

	describe('when membership changes', () => {
		it('should change the fingerprint when a template is added to the stack', () => {
			// GIVEN one template, then the same plus a second [fingerprint.ts:13]
			const one = fingerprintTemplates([{ id: 't1', updatedAt: '100' }])
			const two = fingerprintTemplates([
				{ id: 't1', updatedAt: '100' },
				{ id: 't2', updatedAt: '200' },
			])
			// THEN the fingerprint changes
			expect(two).not.toBe(one)
		})
	})

	describe('when no templates resolve', () => {
		it('should return a fixed sha-256 that re-warms existing keys exactly once', () => {
			// GIVEN the empty resolution [fingerprint.ts:13]
			const empty1 = fingerprintTemplates([])
			const empty2 = fingerprintTemplates([])
			// THEN it is a stable 64-hex-char digest — folding it into the cache key
			// is a single one-time change, not per-run churn
			expect(empty1).toBe(empty2)
			expect(empty1).toMatch(/^[0-9a-f]{64}$/)
		})
	})

	describe('when ids or timestamps would concatenate ambiguously', () => {
		it('should keep distinct resolutions distinct across the field delimiters', () => {
			// GIVEN two resolutions whose naive concatenation would collide but whose
			// delimited encoding does not [fingerprint.ts:13]
			const a = fingerprintTemplates([
				{ id: 't1', updatedAt: '1' },
				{ id: 't2', updatedAt: '2' },
			])
			const b = fingerprintTemplates([
				{ id: 't1', updatedAt: '1@t2' },
				{ id: '', updatedAt: '2' },
			])
			// THEN they fingerprint differently
			expect(a).not.toBe(b)
		})
	})
})
