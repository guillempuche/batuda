import { describe, expect, it } from 'vitest'

import { clipText } from './clip-text'

// Cutting text nobody controls — a scraped page, an email, a model's answer — down
// to a length it can be stored at. What matters is that the cut never lands inside
// a character, because half a character written out as JSON is refused by the
// database and the whole write fails.

describe('clipText', () => {
	describe('when the value is already short enough', () => {
		it('should hand it back exactly as it came', () => {
			// GIVEN values at and under the limit
			// WHEN clipped
			// THEN unchanged — nothing to cut
			expect(clipText('hello', 10)).toBe('hello')
			expect(clipText('hello', 5)).toBe('hello')
			expect(clipText('', 5)).toBe('')
		})
	})

	describe('when the cut lands between the two halves of one character', () => {
		it('should leave the whole character out rather than half of it', () => {
			// GIVEN text whose fourth character is an emoji, cut to four
			const clipped = clipText('abc🚀def', 4)

			// WHEN the result is inspected
			// THEN the emoji is either whole or absent, never half. Half of one is
			// what the database refuses, failing a write that had nothing else wrong
			// with it
			expect(clipped.isWellFormed()).toBe(true)
			expect(clipped).toBe('abc🚀')
		})

		it('should keep the result usable as JSON', () => {
			// GIVEN the shape that broke a real write: a scraped line with an emoji
			// straddling the cut
			const line = `${'x'.repeat(199)}🚀 and more text`
			const clipped = clipText(line, 200)

			// WHEN written out as JSON, the way findings and citations are stored
			// THEN nothing in it needs escaping into something the database will
			// refuse. Cut by storage units instead, this produced `\\ud83d` — six
			// plain characters that reach Postgres and are rejected there
			expect(clipped.isWellFormed()).toBe(true)
			expect(JSON.stringify({ quote: clipped })).not.toContain('\\ud8')
		})
	})

	describe('when the text is written in characters that each take two units', () => {
		it('should count them as a reader would, not as storage does', () => {
			// GIVEN four emoji, which occupy eight units between them
			const clipped = clipText('🚀🚀🚀🚀', 3)

			// WHEN clipped to three
			// THEN three come back. Counting units gave one and a half, so text in
			// such characters was being cut to half the length asked for
			expect([...clipped]).toHaveLength(3)
			expect(clipped.isWellFormed()).toBe(true)
		})
	})

	describe('when the text is ordinary', () => {
		it('should cut at exactly the length asked for', () => {
			// GIVEN plain and accented Latin, and Chinese
			// WHEN clipped
			// THEN the same answer the old reading gave, so nothing already stored
			// changes meaning
			expect(clipText('abcdefgh', 3)).toBe('abc')
			expect(clipText('Calderería Sentmenat', 10)).toBe('Calderería')
			expect(clipText('北京物流有限公司', 4)).toBe('北京物流')
		})
	})

	describe('when a caller marks what it shortened', () => {
		it('should let the caller tell whether anything came off', () => {
			// GIVEN text of few characters stored in many units, and genuinely long
			// text. A caller that asks "is this long?" one way and cuts it another
			// puts an ellipsis on a value it never shortened
			const dense = '🚀'.repeat(70)
			const long = 'a'.repeat(300)

			// WHEN each is clipped
			// THEN comparing the result against what went in answers it exactly,
			// which asking `.length` beforehand does not
			expect(clipText(dense, 120)).toBe(dense)
			expect(clipText(long, 120)).not.toBe(long)
		})
	})

	describe('when the limit is nothing or less', () => {
		it('should give nothing back', () => {
			// GIVEN a limit of zero, and a negative one
			// WHEN clipped
			// THEN empty rather than a slice read from the far end, which is what a
			// negative count does to `slice`
			expect(clipText('hello', 0)).toBe('')
			expect(clipText('hello', -1)).toBe('')
		})
	})
})
