import { describe, expect, it } from 'vitest'

import { formatMoneyCents } from '#/lib/format-money'

describe('formatMoneyCents', () => {
	describe('when formatting a whole-cent amount', () => {
		it('should render euros with two decimals by default', () => {
			// GIVEN a paid-data cost of 1050 cents
			// WHEN formatting it in a euro/English locale
			// THEN it reads as €10.50
			expect(formatMoneyCents(1050, { locale: 'en-IE', currency: 'EUR' })).toBe(
				'€10.50',
			)
		})
	})

	describe('when the amount is zero', () => {
		it('should still render a currency value, not an empty string', () => {
			// GIVEN nothing has been spent
			// WHEN formatting zero cents
			// THEN it shows a zero currency amount
			expect(formatMoneyCents(0, { locale: 'en-IE', currency: 'EUR' })).toBe(
				'€0.00',
			)
		})
	})

	describe('when a non-euro currency is requested', () => {
		it('should honor the requested currency symbol', () => {
			// GIVEN a US-dollar amount
			// WHEN formatting with a US locale and USD
			// THEN it renders with the dollar symbol
			expect(formatMoneyCents(2500, { locale: 'en-US', currency: 'USD' })).toBe(
				'$25.00',
			)
		})
	})

	describe('when the cents carry sub-cent precision', () => {
		it('should round to the currency minor units', () => {
			// GIVEN a fractional-cent input
			// WHEN formatting it
			// THEN it rounds to two decimals
			expect(
				formatMoneyCents(1049.6, { locale: 'en-IE', currency: 'EUR' }),
			).toBe('€10.50')
		})
	})
})
