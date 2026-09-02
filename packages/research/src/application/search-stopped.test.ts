import { describe, expect, it } from 'vitest'

import {
	coverageStoppedLooking,
	mostBindingStop,
	wasCutOff,
} from './search-stopped'

describe('mostBindingStop', () => {
	describe('when every stretch ran out of things to try', () => {
		it('should say the looking finished', () => {
			// GIVEN two stretches that each ended with nothing left to do
			const reason = mostBindingStop('finished_looking', 'finished_looking')

			// THEN nothing stopped the run, so that is what it reports
			expect(reason).toBe('finished_looking')
		})
	})

	describe('when one stretch met a ceiling and another settled', () => {
		it('should keep the ceiling when the later stretch settled', () => {
			// GIVEN a first stretch stopped at its round cap, then one the model
			// ended by itself
			const reason = mostBindingStop('round_cap_reached', 'finished_looking')

			// THEN the ceiling stands: a later stretch settling says nothing about
			// the one that was cut short, and reporting it as finished would be the
			// silence this reading exists to break
			expect(reason).toBe('round_cap_reached')
		})

		it('should take the ceiling when it is the later stretch that met one', () => {
			// GIVEN a first stretch the model finished and a second out of money
			const reason = mostBindingStop('finished_looking', 'budget_exhausted')

			// THEN the run was stopped, whichever stretch it happened in
			expect(reason).toBe('budget_exhausted')
		})
	})

	describe('when two stretches met different ceilings', () => {
		it('should name the money over a round cap met earlier', () => {
			// GIVEN a first stretch stopped by its round cap and a later one that
			// ran the run out of money
			const reason = mostBindingStop('round_cap_reached', 'budget_exhausted')

			// THEN the money is named. Rounds are counted per stretch and start
			// again at the next one, so the run got past that cap; the money is
			// counted across the whole run and left nothing for anything after —
			// and a reader told the round cap would raise a limit that was never
			// what stopped it
			expect(reason).toBe('budget_exhausted')
		})

		it('should keep the money when a later stretch only met a round cap', () => {
			// GIVEN the money gone first, then a stretch stopped by its round cap
			const reason = mostBindingStop('budget_exhausted', 'round_cap_reached')

			// THEN the money still stands, whichever order the two came in
			expect(reason).toBe('budget_exhausted')
		})

		it('should keep the earlier of two equally binding ceilings', () => {
			// GIVEN a full prompt and then a round cap, neither harder than the other
			const reason = mostBindingStop('context_full', 'round_cap_reached')

			// THEN the first is kept: it is the one every stretch after it worked
			// under
			expect(reason).toBe('context_full')
		})
	})
})

describe('wasCutOff', () => {
	describe('when the looking ran out of things to try', () => {
		it('should say it was not cut off', () => {
			expect(wasCutOff('finished_looking')).toBe(false)
		})
	})

	describe('when something stopped the looking', () => {
		it('should say so for every reason that is not finishing', () => {
			// GIVEN each of the ways a run can be stopped
			// THEN all of them read as cut off — a reason added to the list must
			// land on one side of this question deliberately, not by default
			expect(wasCutOff('round_cap_reached')).toBe(true)
			expect(wasCutOff('context_full')).toBe(true)
			expect(wasCutOff('deadline_reached')).toBe(true)
			expect(wasCutOff('budget_exhausted')).toBe(true)
		})
	})
})

describe('coverageStoppedLooking', () => {
	describe('when the chase ended having answered every part', () => {
		it('should take nothing away from the run', () => {
			// GIVEN a chase that stopped because nothing was left uncovered
			// THEN it did not stop the looking, so it has nothing to report
			expect(coverageStoppedLooking('answered')).toBeNull()
		})
	})

	describe('when there was no chase at all', () => {
		it('should take nothing away from the run', () => {
			// GIVEN a request with too few parts to chase, so no verdict was reached
			expect(coverageStoppedLooking(null)).toBeNull()
		})
	})

	describe('when the provider refused a pass of the chase', () => {
		it('should report that, not one of the ceilings the run sets itself', () => {
			// GIVEN a chase stopped because the provider would not answer a pass
			// THEN it is its own reason: a reader told the round cap was reached
			// would go and raise a number that never stopped anything
			expect(coverageStoppedLooking('provider_failed')).toBe('provider_refused')
			expect(coverageStoppedLooking('provider_failed')).not.toBe(
				'round_cap_reached',
			)
		})

		it('should count as having cut the looking short', () => {
			// GIVEN the reason a refused pass reports
			// THEN the run knows its list is short because it was stopped, which is
			// the whole question this answers — a thin market reads the same way
			expect(wasCutOff('provider_refused')).toBe(true)
		})

		it('should not hide a harder reason from another stretch', () => {
			// GIVEN a gathering stretch that ran out of money and a chase the
			// provider refused
			// THEN the money is reported, because it leaves no room to look again
			// while a refused pass does not
			expect(mostBindingStop('budget_exhausted', 'provider_refused')).toBe(
				'budget_exhausted',
			)
			// AND against a stretch that simply settled, the refusal is what the
			// reader needs
			expect(mostBindingStop('finished_looking', 'provider_refused')).toBe(
				'provider_refused',
			)
		})
	})

	describe('when the chase ran out of something', () => {
		it('should name what it ran out of, in the words the run reports', () => {
			// GIVEN each way the chase can be stopped with parts still unanswered
			// THEN each maps to the reason the run reports, so a request whose last
			// part was chased until the passes ran out cannot read as having
			// finished looking
			expect(coverageStoppedLooking('passes_spent')).toBe('round_cap_reached')
			expect(coverageStoppedLooking('deadline_margin')).toBe('deadline_reached')
			expect(coverageStoppedLooking('budget_margin')).toBe('budget_exhausted')
		})
	})

	describe('when the chase was still going', () => {
		it('should take nothing away from the run', () => {
			// GIVEN the verdict that sends another pass out rather than stopping
			expect(coverageStoppedLooking('go')).toBeNull()
		})
	})
})
