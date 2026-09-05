import { describe, expect, it } from 'vitest'

import { NAME_ONLY_EVIDENCE } from './name-only-guard'
import { prospectHoldBack } from './prospect-hold-back'
import { EXISTENCE_UNCONFIRMED, OUTSIDE_REQUESTED_PLACE } from './row-marks'

describe('prospectHoldBack', () => {
	describe('when the run stands behind the company', () => {
		it('should hold nothing back', () => {
			// GIVEN a row the run neither doubted nor placed elsewhere
			const held = prospectHoldBack({})

			// THEN nothing is held back, so the company may be recorded as a checked one
			expect(held).toEqual({
				couldNotConfirm: false,
				outsidePlace: false,
				holdsBack: false,
				spokenReason: undefined,
				missing: undefined,
				nameOnly: false,
			})
		})
	})

	describe('when the run said in its own words why it could not confirm', () => {
		it('should hold the company back and hand on what it said', () => {
			// GIVEN a row carrying a reason the run wrote, with blank space around it
			const held = prospectHoldBack({
				unconfirmed_reason: '  no website and no register entry  ',
			})

			// THEN it is held back as unconfirmed rather than as misplaced, and the
			//   reason comes back trimmed so no caller trims it a second time
			expect(held.couldNotConfirm).toBe(true)
			expect(held.outsidePlace).toBe(false)
			expect(held.holdsBack).toBe(true)
			expect(held.spokenReason).toBe('no website and no register entry')
		})
	})

	describe('when the reason is only blank space', () => {
		it('should not hold the company back on it', () => {
			// GIVEN a reason field holding nothing a reader could act on
			const held = prospectHoldBack({ unconfirmed_reason: '   ' })

			// THEN the row is not held back. Held back on this, the company could
			//   not be recorded as checked, and no cause would be named at all.
			expect(held.holdsBack).toBe(false)
			expect(held.spokenReason).toBeUndefined()
		})
	})

	describe('when every page citing the company listed many of them', () => {
		it('should hold the company back without the run saying anything', () => {
			// GIVEN the engine's own finding, and no sentence from the run
			const held = prospectHoldBack({
				unconfirmed_evidence: NAME_ONLY_EVIDENCE,
			})

			// THEN it is held back, and offers no sentence of its own: the run wrote
			//   none, so whatever a reader is shown is not the run's words
			expect(held.couldNotConfirm).toBe(true)
			expect(held.holdsBack).toBe(true)
			expect(held.spokenReason).toBeUndefined()
			// AND the cause is named, so the surface can say this one rather than
			//   the sentence for a run that stopped before checking
			expect(held.nameOnly).toBe(true)
			expect(held.missing).toBeUndefined()
		})
	})

	describe('when a blank reason sits beside that finding', () => {
		it('should still hold the company back on the finding', () => {
			// GIVEN both fields written, but only one of them saying anything
			const held = prospectHoldBack({
				unconfirmed_reason: '  ',
				unconfirmed_evidence: NAME_ONLY_EVIDENCE,
			})

			// THEN the blank reason does not stand in for the finding. Read the
			//   other way round, it would cancel the finding and let the company be
			//   recorded as checked.
			expect(held.couldNotConfirm).toBe(true)
			expect(held.holdsBack).toBe(true)
		})
	})

	describe('when the evidence field says something else entirely', () => {
		it('should not hold the company back on it', () => {
			// GIVEN a value this rule knows nothing about
			const held = prospectHoldBack({
				unconfirmed_evidence: 'some_future_finding',
			})

			// THEN it is not held back. A rule that treated any value as a doubt
			//   would hold back every row the day a second finding is added.
			expect(held.couldNotConfirm).toBe(false)
			expect(held.holdsBack).toBe(false)
		})
	})

	describe('when the run placed the company outside the area asked about', () => {
		it('should hold it back as misplaced, not as unconfirmed', () => {
			// GIVEN a row the run marked as outside the requested place
			const held = prospectHoldBack({ marks: [OUTSIDE_REQUESTED_PLACE] })

			// THEN the two are told apart. Here the run established something
			//   rather than failing to, and one answer for both tells a reader
			//   neither.
			expect(held.outsidePlace).toBe(true)
			expect(held.couldNotConfirm).toBe(false)
			expect(held.holdsBack).toBe(true)
		})
	})

	describe('when that mark arrives behind another one', () => {
		it('should still find it', () => {
			// GIVEN a row marked twice: it can be two things at once, and neither
			//   may be the one read first
			const held = prospectHoldBack({
				marks: ['some_other_mark', OUTSIDE_REQUESTED_PLACE],
			})

			// THEN the place is found wherever it sits
			expect(held.outsidePlace).toBe(true)
			expect(held.holdsBack).toBe(true)
		})
	})

	describe('when the company is both doubted and placed elsewhere', () => {
		it('should report both, not the first of them', () => {
			// GIVEN a row carrying each kind of hold-back at once
			const held = prospectHoldBack({
				unconfirmed_reason: 'no register entry',
				marks: [OUTSIDE_REQUESTED_PLACE],
			})

			// THEN both are reported, so a reader is pointed at each reason. The
			//   place is the half likelier to stop somebody adding the company.
			expect(held).toEqual({
				couldNotConfirm: true,
				outsidePlace: true,
				holdsBack: true,
				spokenReason: 'no register entry',
				missing: undefined,
				nameOnly: false,
			})
		})
	})

	describe('when the row carries marks that say nothing about this', () => {
		it('should not hold the company back on them', () => {
			// GIVEN a row marked for some other reason entirely
			const held = prospectHoldBack({ marks: ['some_other_mark'] })

			// THEN it is not held back
			expect(held.holdsBack).toBe(false)
		})
	})
	describe('when the existence check could not establish the company', () => {
		it('should hold it back and hand on the word for what was missing', () => {
			// GIVEN a row the check marked, saying what it did not find
			const held = prospectHoldBack({
				marks: [EXISTENCE_UNCONFIRMED],
				existence_reason: 'no_own_site',
			})

			// THEN it is held back as unconfirmed, carrying the word rather than a
			//   sentence, so the surface says it in the reader's language. Before
			//   this the check wrote to a field only the run itself read, and a row
			//   it could not stand behind reached the reader looking like one it
			//   could.
			expect(held.couldNotConfirm).toBe(true)
			expect(held.outsidePlace).toBe(false)
			expect(held.holdsBack).toBe(true)
			expect(held.missing).toBe('no_own_site')
			expect(held.nameOnly).toBe(false)
		})
	})

	describe('when the run stopped short of checking the company', () => {
		it("should say so with the run's own word, not a finding", () => {
			// GIVEN a row marked because the run spent its allowance first
			const held = prospectHoldBack({
				marks: [EXISTENCE_UNCONFIRMED],
				existence_reason: 'budget_exhausted',
			})

			// THEN the word comes through untouched. Folded into the findings, a
			//   reader would hear that the search looked and came back empty, when
			//   it never looked at all.
			expect(held.missing).toBe('budget_exhausted')
			expect(held.couldNotConfirm).toBe(true)
		})
	})

	describe('when a stored row carries a word this build does not know', () => {
		it('should still hold it back, without a word for why', () => {
			// GIVEN a row marked with a reason from some later vocabulary
			const held = prospectHoldBack({
				marks: [EXISTENCE_UNCONFIRMED],
				existence_reason: 'some_future_reason',
			})

			// THEN the doubt survives and only the wording is lost. Read the other
			//   way round, an unreadable word would quietly clear the row.
			expect(held.couldNotConfirm).toBe(true)
			expect(held.holdsBack).toBe(true)
			expect(held.missing).toBeUndefined()
		})
	})

	describe('when a row carries a reason but no mark', () => {
		it('should not hold it back on the reason alone', () => {
			// GIVEN a reason left behind by an earlier pass that later stopped
			//   doubting the company
			const held = prospectHoldBack({ existence_reason: 'no_own_site' })

			// THEN nothing is held back: the mark is what says the run doubts the
			//   row, and a leftover word is not a doubt.
			expect(held.couldNotConfirm).toBe(false)
			expect(held.holdsBack).toBe(false)
			expect(held.missing).toBeUndefined()
		})
	})

	describe('when the company is doubted and placed elsewhere at once', () => {
		it('should report the existence doubt beside the place', () => {
			// GIVEN a row wearing both marks
			const held = prospectHoldBack({
				marks: [OUTSIDE_REQUESTED_PLACE, EXISTENCE_UNCONFIRMED],
				existence_reason: 'one_website',
			})

			// THEN each is found wherever it sits in the list
			expect(held.couldNotConfirm).toBe(true)
			expect(held.outsidePlace).toBe(true)
			expect(held.missing).toBe('one_website')
		})
	})
})
