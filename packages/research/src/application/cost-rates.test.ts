import { describe, expect, it } from 'vitest'

import { priceLlmMicrocents, priceUnitsMicrocents } from './cost-rates'

describe('priceLlmMicrocents', () => {
	describe('when a call read and wrote text', () => {
		it('should charge each direction at its own rate', () => {
			// GIVEN a slot charging 0.01c per thousand read and 0.03c per thousand
			// written, and a call that read 2000 and wrote 1000
			const rate = { inCentsPer1k: 0.01, outCentsPer1k: 0.03 }

			// WHEN the call is priced
			const microcents = priceLlmMicrocents(2000, 1000, rate)

			// THEN both directions are billed: 0.02c + 0.03c
			expect(microcents).toBe(50_000)
		})
	})

	describe('when a call is far below a whole cent', () => {
		it('should keep the amount rather than round it away', () => {
			// GIVEN a cheap slot and a small call worth 0.000016c
			const rate = { inCentsPer1k: 0.004, outCentsPer1k: 0.008 }

			// WHEN priced
			const microcents = priceLlmMicrocents(2, 1, rate)

			// THEN it still records a figure — rounding here would report the run
			// as free, and a run is thousands of these
			expect(microcents).toBe(16)
		})
	})

	describe('when a call reported no tokens', () => {
		it('should cost nothing', () => {
			// GIVEN a provider that reported no usage
			// WHEN priced
			// THEN nothing is charged
			expect(
				priceLlmMicrocents(0, 0, { inCentsPer1k: 1, outCentsPer1k: 1 }),
			).toBe(0)
		})
	})
})

describe('priceUnitsMicrocents', () => {
	describe('when a provider reported several credits for one call', () => {
		it('should charge every credit, not the call', () => {
			// GIVEN a search that consumed 7 credits at 0.06c each
			// WHEN priced
			// THEN all seven are billed
			expect(priceUnitsMicrocents(7, 0.06)).toBe(420_000)
		})
	})

	describe('when a call consumed no credits', () => {
		it('should cost nothing', () => {
			// GIVEN a cached answer, which reports no credits
			// WHEN priced
			// THEN nothing is charged
			expect(priceUnitsMicrocents(0, 0.06)).toBe(0)
		})
	})
})
