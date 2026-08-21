import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { assertSendable } from './email'

// Every way of sending a message funnels through `dispatchOutbound`, which
// calls this first. The two shapes it refuses both get a message scored as
// spam by the receiving server, and we only learn that much later — so the
// cost of a wrong answer here is asymmetric, and the false-positive cases
// (a subject that merely starts with the letters "re") matter as much as the
// true ones: a wrong refusal blocks ordinary mail nobody can send another way.

const failureOf = (message: {
	subject: string
	inReplyTo?: string | undefined
	references?: readonly string[] | undefined
}) => {
	const exit = Effect.runSyncExit(assertSendable(message))
	if (Exit.isSuccess(exit)) return null
	for (const reason of exit.cause.reasons) {
		if (Cause.isFailReason(reason)) return reason.error
	}
	return null
}

// Why the send was refused, or null when it was allowed. The guard answers
// with a reason rather than a sentence, so each surface can word it its own
// way — and so telemetry can count the reasons apart.
const refusalOf = (message: {
	subject: string
	inReplyTo?: string | undefined
	references?: readonly string[] | undefined
}): string | null => failureOf(message)?.reason ?? null

const PARENT = '<parent@mail.infomaniak.com>'

describe('assertSendable', () => {
	describe('when the message has an ordinary subject', () => {
		it('should allow a new message that threads nothing', () => {
			// GIVEN a plain subject and no threading headers
			// WHEN the guard runs
			// THEN the send is allowed
			expect(refusalOf({ subject: 'your pallet pools' })).toBeNull()
		})

		it('should allow an ordinary subject that does thread', () => {
			// GIVEN a reply whose writer changed the subject rather than
			// keeping the parent's
			// WHEN the guard runs
			// THEN the send is allowed
			// AND threading headers are never on their own a reason to refuse
			expect(
				refusalOf({ subject: 'new quote attached', inReplyTo: PARENT }),
			).toBeNull()
		})

		it('should allow a subject that is not written in English', () => {
			// GIVEN accented and non-Latin subjects
			// WHEN the guard runs
			// THEN none of them are refused
			expect(refusalOf({ subject: 'Pressupost per als palets' })).toBeNull()
			expect(refusalOf({ subject: 'Presupuesto — envío' })).toBeNull()
			expect(refusalOf({ subject: '見積書' })).toBeNull()
		})

		it('should succeed with no value rather than a result to inspect', () => {
			// GIVEN an allowable message
			// WHEN the guard runs
			// THEN it completes without producing anything
			// AND callers use it for its failure alone
			const exit = Effect.runSyncExit(assertSendable({ subject: 'pools' }))
			expect(Exit.isSuccess(exit)).toBe(true)
		})
	})

	describe('when the subject only looks like a reply prefix', () => {
		it('should allow a word that merely starts with the letters "re"', () => {
			// GIVEN words beginning "re" with no colon straight after
			// WHEN the guard runs
			// THEN none of them are refused
			// AND a false positive here blocks ordinary mail
			expect(refusalOf({ subject: 'Reminder: pay the invoice' })).toBeNull()
			expect(refusalOf({ subject: 'Renewal quote attached' })).toBeNull()
			expect(refusalOf({ subject: 'Rescheduling Thursday' })).toBeNull()
		})

		it('should allow a "Ref:" reference prefix', () => {
			// GIVEN the reference prefix ordinary business mail uses
			// WHEN the guard runs
			// THEN it is not mistaken for a reply prefix
			expect(refusalOf({ subject: 'Ref: 2026-0114' })).toBeNull()
		})

		it('should allow "re" with no colon at all', () => {
			// GIVEN the bare letters and nothing else
			// WHEN the guard runs
			// THEN the send is allowed
			expect(refusalOf({ subject: 're' })).toBeNull()
			expect(refusalOf({ subject: 're the pallet pools' })).toBeNull()
		})

		it('should allow "Re:" appearing somewhere other than the start', () => {
			// GIVEN the prefix buried mid-subject
			// WHEN the guard runs
			// THEN only a leading one counts
			expect(refusalOf({ subject: 'Score: Re: last match' })).toBeNull()
		})
	})

	describe('when the subject is missing', () => {
		it('should refuse an empty subject', () => {
			// GIVEN nothing in the subject
			// WHEN the guard runs
			// THEN the send is refused
			// AND the reason says what the recipient would have seen
			expect(refusalOf({ subject: '' })).toBe('no_subject')
		})

		it('should refuse a subject that is only blank space', () => {
			// GIVEN spaces, tabs and newlines but no text
			// WHEN the guard runs
			// THEN each counts as empty
			// [trim()]
			for (const subject of ['   ', '\t', '\n', ' \t\n ']) {
				expect(refusalOf({ subject })).toBe('no_subject')
			}
		})

		it('should refuse an empty subject even when the message threads correctly', () => {
			// GIVEN correct threading headers but no subject
			// WHEN the guard runs
			// THEN the send is still refused
			// AND this is the exact shape the reply path used to send
			expect(
				refusalOf({
					subject: '',
					inReplyTo: PARENT,
					references: [PARENT],
				}),
			).toBe('no_subject')
		})
	})

	describe('when the subject claims to be a reply but answers nothing', () => {
		it('should refuse it', () => {
			// GIVEN a reply prefix and nothing for it to answer
			// WHEN the guard runs
			// THEN the send is refused
			// AND it names which of the two shapes it was
			expect(refusalOf({ subject: 'Re: your pallet pools' })).toBe(
				'forged_reply',
			)
		})

		it('should refuse however the prefix is capitalised or spaced', () => {
			// GIVEN the prefix written the ways mail clients write it
			// WHEN the guard runs
			// THEN each one is refused
			// [/^re\s*:/i]
			for (const subject of [
				'RE: pools',
				're: pools',
				'rE: pools',
				'Re : pools',
				'Re\t: pools',
				'Re:',
				'Re: Re: pools',
			]) {
				expect(refusalOf({ subject })).toBe('forged_reply')
			}
		})

		it('should refuse a prefix hidden behind leading blank space', () => {
			// GIVEN blank space before the prefix
			// WHEN the guard runs
			// THEN it is still recognised
			// AND trimming happens before the prefix is looked for
			expect(refusalOf({ subject: '   Re: pools' })).toBe('forged_reply')
		})

		it('should refuse when references is present but empty', () => {
			// GIVEN an empty references array rather than an absent one
			// WHEN the guard runs
			// THEN it counts as answering nothing
			expect(refusalOf({ subject: 'Re: pools', references: [] })).toBe(
				'forged_reply',
			)
		})

		it('should refuse when in-reply-to is present but blank', () => {
			// GIVEN an empty-string parent id
			// WHEN the guard runs
			// THEN it counts as answering nothing
			expect(refusalOf({ subject: 'Re: pools', inReplyTo: '' })).toBe(
				'forged_reply',
			)
		})

		it('should refuse when both threading headers are blank or empty', () => {
			// GIVEN both present but carrying nothing
			// WHEN the guard runs
			// THEN the send is refused
			expect(
				refusalOf({ subject: 'Re: pools', inReplyTo: '', references: [] }),
			).toBe('forged_reply')
		})
	})

	describe('when the subject claims to be a reply and answers something', () => {
		it('should allow a message naming its parent', () => {
			// GIVEN a reply prefix and an In-Reply-To header
			// WHEN the guard runs
			// THEN the send is allowed
			expect(
				refusalOf({ subject: 'Re: your pallet pools', inReplyTo: PARENT }),
			).toBeNull()
		})

		it('should allow a message carrying only a references chain', () => {
			// GIVEN references but no In-Reply-To
			// WHEN the guard runs
			// THEN the send is allowed
			// AND either header alone is enough to make it a real reply
			expect(
				refusalOf({ subject: 'Re: your pallet pools', references: [PARENT] }),
			).toBeNull()
		})

		it('should allow a message carrying both headers', () => {
			// GIVEN the shape the reply path now produces
			// WHEN the guard runs
			// THEN the send is allowed
			expect(
				refusalOf({
					subject: 'Re: your pallet pools',
					inReplyTo: PARENT,
					references: ['<root@client.test>', PARENT],
				}),
			).toBeNull()
		})

		it('should treat a references entry it cannot use as an answer anyway', () => {
			// GIVEN a references array holding one empty string
			// WHEN the guard runs
			// THEN the send is allowed, because the guard counts entries
			// rather than reading them
			// AND this pins what the guard does today: it is a cheap check on
			// the two shapes filters punish, not a validator of header contents
			expect(refusalOf({ subject: 'Re: pools', references: [''] })).toBeNull()
		})
	})

	describe('when a caller needs to map the refusal to a response', () => {
		it('should fail with an EmailError the handlers can catch by tag', () => {
			// GIVEN a refused message
			// WHEN the failure is inspected
			// THEN it carries a tag of its own, separate from the one used for
			// genuine faults — that separation is what lets a refusal come back
			// as a 400 the sender can act on while a fault still reads as a fault
			// [catchTag('EmailNotSendable')]
			expect(failureOf({ subject: '' })?._tag).toBe('EmailNotSendable')
			expect(failureOf({ subject: 'Re: pools' })?._tag).toBe('EmailNotSendable')
		})
	})
})
