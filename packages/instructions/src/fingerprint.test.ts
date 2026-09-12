import { describe, expect, it } from 'vitest'

import { fingerprintAttributes, fingerprintTemplates } from './fingerprint'

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

describe('fingerprintAttributes', () => {
	const sites = {
		key: 'site_count',
		label: 'Sites',
		kind: 'number' as const,
		enumValues: null,
		unit: 'sites',
		description: 'How many premises.',
	}
	const fit = {
		key: 'fit',
		label: 'Fit',
		kind: 'enum' as const,
		enumValues: ['strong', 'no'],
		unit: null,
		description: null,
	}

	describe('when the same declarations arrive in a different order', () => {
		it('should produce the same fingerprint without touching the given array', () => {
			// GIVEN the two declarations both ways round
			const given = [fit, sites]
			// THEN the digest is the same and the array is as it was
			expect(fingerprintAttributes([sites, fit])).toBe(
				fingerprintAttributes(given),
			)
			expect(given).toEqual([fit, sites])
		})
	})

	describe('when something that reaches a prompt changes', () => {
		it('should change for a label, description, unit, kind, key or word-order change, and for a declaration added', () => {
			// GIVEN one declaration edited in each field in turn
			const base = fingerprintAttributes([sites, fit])
			const edits = [
				[{ ...sites, label: 'Premises' }, fit],
				[{ ...sites, description: 'Changed.' }, fit],
				[{ ...sites, unit: 'towns' }, fit],
				[{ ...sites, kind: 'text' as const }, fit],
				[{ ...sites, key: 'sites' }, fit],
				[sites, { ...fit, enumValues: ['no', 'strong'] }],
				[sites],
			]
			// THEN every edit reads as a different set
			const digests = new Set(edits.map(fingerprintAttributes))
			expect(digests.size).toBe(edits.length)
			expect(digests.has(base)).toBe(false)
		})

		it('should keep a line break in a label from forging a second entry', () => {
			// GIVEN one label carrying the separator a second entry would use
			const forged = fingerprintAttributes([
				{ ...sites, label: 'Sites"]\n["Fit' },
			])
			// THEN it is not the digest of two entries
			expect(forged).not.toBe(fingerprintAttributes([sites, fit]))
		})
	})

	describe('when there are no declarations', () => {
		it('should return a fixed digest, the same as an empty template list', () => {
			// GIVEN nothing declared
			// THEN the digest is stable and shared with the empty template case
			expect(fingerprintAttributes([])).toMatch(/^[0-9a-f]{64}$/)
			expect(fingerprintAttributes([])).toBe(fingerprintTemplates([]))
		})
	})
})
