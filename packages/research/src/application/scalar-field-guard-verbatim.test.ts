import { describe, expect, it } from 'vitest'

import { quoteIsVerbatim } from './scalar-field-guard'

const FLEET = 'acme freight operates a fleet of 40 owned trucks.'
const GROCERS = 'we haul refrigerated loads for regional grocers.'

describe('quoteIsVerbatim, over the corpus each quote is judged against', () => {
	it('should judge every quote against the corpus handed to it', () => {
		// GIVEN one quote asked of two runs' evidence in turn, the words being on
		// the first page only
		expect(quoteIsVerbatim('a fleet of 40 owned trucks', FLEET)).toBe(true)
		expect(quoteIsVerbatim('a fleet of 40 owned trucks', GROCERS)).toBe(false)

		// THEN coming back to the first corpus judges it by that corpus again,
		// rather than by whatever was read last
		expect(quoteIsVerbatim('a fleet of 40 owned trucks', FLEET)).toBe(true)
	})

	it('should look for a quote of one short word as a word of its own', () => {
		// GIVEN a title too short to be looked for run into the letters around it
		expect(quoteIsVerbatim('CEO', 'ana puig, ceo')).toBe(true)
		// AND the same letters sitting inside other words, which say nothing
		expect(quoteIsVerbatim('CEO', 'trece ocupaciones en la planta')).toBe(false)
		// AND a quote with no words at all
		expect(quoteIsVerbatim('', FLEET)).toBe(false)
	})
})
