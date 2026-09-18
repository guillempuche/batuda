// What the filters make of what somebody typed.
//
// Two of them are worth reading closely. An address filter that quietly matched
// more than it looks like it should would hand over mail nobody asked for, and
// a date reader that accepts anything would turn 30 February into 2 March
// without a word, or read a moment against whichever clock the server keeps.
// Both refuse instead, in words, because a filter that finds nothing reads as
// "you have none of those".

import { describe, expect, it } from 'vitest'

import {
	checkDateRange,
	parseDateBound,
	parseParticipant,
} from './email-list-filters'

describe('parseParticipant [email-list-filters.ts]', () => {
	describe('when given an address', () => {
		it('should read it whatever case and spacing it arrives in', () => {
			// GIVEN an address typed with capitals and stray spaces
			// WHEN it is read
			const parsed = parseParticipant('  Ana@ACME.test ')
			// THEN it matches the form addresses are stored in
			expect(parsed).toEqual({ kind: 'address', address: 'ana@acme.test' })
		})

		it('should keep non-ASCII letters as they are', () => {
			// GIVEN an address with an accented letter
			// WHEN it is read
			const parsed = parseParticipant('ÜBER@acme.test')
			// THEN only its case changes
			expect(parsed).toEqual({ kind: 'address', address: 'über@acme.test' })
		})
	})

	describe('when given a domain', () => {
		it('should read the part after the @', () => {
			// GIVEN a domain written the way people write one
			// WHEN it is read
			const parsed = parseParticipant('@ACME.test')
			// THEN it is a domain, lowercased
			expect(parsed).toEqual({ kind: 'domain', domain: 'acme.test' })
		})
	})

	describe('when given something that would match far too much', () => {
		it.each([
			['nothing at all', '   '],
			['an @ on its own', '@'],
			['an address with no domain', 'ana@'],
			['a domain with no @', 'acme.test'],
			['a name and address together', 'Ana <ana@acme.test>'],
			['a domain that starts with a dot', '@.acme.test'],
		])('should refuse %s', (_why, value) => {
			// GIVEN a value that is not one address or one domain
			// WHEN it is read
			const parsed = parseParticipant(value)
			// THEN it is refused rather than turned into a wide match
			expect(parsed.kind).toBe('refused')
		})
	})
})

describe('parseDateBound [email-list-filters.ts]', () => {
	describe('when given a day', () => {
		it('should read it as that day beginning, everywhere', () => {
			// GIVEN a plain day
			// WHEN it is read
			const parsed = parseDateBound('2026-09-01')
			// THEN it is midnight UTC, whatever clock the machine keeps
			expect('at' in parsed && parsed.at.toISOString()).toBe(
				'2026-09-01T00:00:00.000Z',
			)
		})
	})

	describe('when given a moment that says its timezone', () => {
		it('should read an offset and a Z as the same instant', () => {
			// GIVEN the same instant written two ways
			// WHEN both are read
			const withOffset = parseDateBound('2026-09-01T02:00:00+02:00')
			const withZ = parseDateBound('2026-09-01T00:00:00Z')
			// THEN they agree
			expect('at' in withOffset && withOffset.at.getTime()).toBe(
				'at' in withZ ? withZ.at.getTime() : null,
			)
		})
	})

	describe('when given a date that is not on the calendar', () => {
		it.each(['2026-02-30', '2026-13-01'])('should refuse %s', value => {
			// GIVEN a day that does not exist
			// WHEN it is read
			const parsed = parseDateBound(value)
			// THEN it is refused, rather than rolling into the next month
			expect('refused' in parsed).toBe(true)
		})
	})

	describe('when given a form that means different things in different places', () => {
		it.each([
			['a bare year', '2026'],
			['a lone digit', '1'],
			['a written date', 'Sep 1 2026'],
			['a slashed date', '09/01/2026'],
			['a moment with no timezone', '2026-09-01T00:00:00'],
		])('should refuse %s', (_why, value) => {
			// GIVEN a value the ordinary date reader would accept and guess at
			// WHEN it is read
			const parsed = parseDateBound(value)
			// THEN it is refused with something to act on
			expect('refused' in parsed).toBe(true)
		})
	})
})

describe('checkDateRange [email-list-filters.ts]', () => {
	describe('when the range can hold something', () => {
		it.each([
			['a day apart', '2026-09-01', '2026-09-02'],
			[
				'a millisecond apart',
				'2026-09-01T00:00:00.000Z',
				'2026-09-01T00:00:00.001Z',
			],
		])('should accept bounds %s', (_why, after, before) => {
			// GIVEN an opening bound earlier than the closing one
			// WHEN the range is checked
			const refused = checkDateRange({ after, before, names: ['a', 'b'] })
			// THEN nothing is refused
			expect(refused).toBeNull()
		})

		it('should accept one bound on its own', () => {
			// GIVEN only an opening bound
			// WHEN the range is checked
			const refused = checkDateRange({ after: '2026-09-01', names: ['a', 'b'] })
			// THEN nothing is refused
			expect(refused).toBeNull()
		})
	})

	describe('when the range can only find nothing', () => {
		it.each([
			['the same moment twice', '2026-09-01', '2026-09-01'],
			['the wrong way round', '2026-09-02', '2026-09-01'],
		])('should refuse %s and name both sides', (_why, after, before) => {
			// GIVEN bounds that cross
			// WHEN the range is checked
			const refused = checkDateRange({
				after,
				before,
				names: ['last_message_after', 'last_message_before'],
			})
			// THEN it says so, naming what to change
			expect(refused?.refused).toContain('last_message_after')
			expect(refused?.refused).toContain('last_message_before')
		})
	})

	describe('when a bound cannot be read at all', () => {
		it('should pass the reason on rather than the range complaint', () => {
			// GIVEN an opening bound that is not a date
			// WHEN the range is checked
			const refused = checkDateRange({ after: 'nope', names: ['a', 'b'] })
			// THEN what comes back is about the value itself
			expect(refused?.refused).toContain('nope')
		})
	})
})
