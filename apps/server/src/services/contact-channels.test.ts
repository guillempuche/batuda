import { describe, expect, it } from 'vitest'

import { clampConfidence } from './contact-channels'

describe('clampConfidence', () => {
	describe('when the value is a 0–1 fraction (the research model scale)', () => {
		it('should scale it up to the 0–100 whole number the column stores', () => {
			// GIVEN a fractional confidence the model emits
			// THEN it becomes a rounded 0–100 score, not a coerced 0/1
			expect(clampConfidence(0.85)).toBe(85)
			expect(clampConfidence(0.5)).toBe(50)
			expect(clampConfidence(1)).toBe(100)
			expect(clampConfidence(0)).toBe(0)
		})
	})

	describe('when the value already uses the 0–100 scale (enrichment/verification)', () => {
		it('should keep it, rounded to a whole number', () => {
			// GIVEN a score a vendor already reports on 0–100
			expect(clampConfidence(90)).toBe(90)
			expect(clampConfidence(87.4)).toBe(87)
			expect(clampConfidence(87.6)).toBe(88)
		})
	})

	describe('when the value sits on the boundary between the two scales', () => {
		it('should treat exactly 1 as a full fraction and just above 1 as a score', () => {
			// GIVEN 1, the top of the fraction range
			expect(clampConfidence(1)).toBe(100)
			// GIVEN a whole-number score at the ceiling
			expect(clampConfidence(100)).toBe(100)
		})
	})

	describe('when the value falls outside 0–100', () => {
		it('should clamp it into range', () => {
			// GIVEN a score above the ceiling
			expect(clampConfidence(150)).toBe(100)
			// GIVEN a negative fraction (scaled below the floor)
			expect(clampConfidence(-0.2)).toBe(0)
		})
	})

	describe('when there is no usable number', () => {
		it('should return null so the column stays empty', () => {
			// GIVEN a missing or non-finite confidence
			expect(clampConfidence(null)).toBeNull()
			expect(clampConfidence(undefined)).toBeNull()
			expect(clampConfidence(Number.NaN)).toBeNull()
			expect(clampConfidence(Number.POSITIVE_INFINITY)).toBeNull()
			expect(clampConfidence(Number.NEGATIVE_INFINITY)).toBeNull()
		})
	})
})
