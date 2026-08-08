import { describe, expect, it } from 'vitest'

import { badRequestMessage, taggedFailure } from './tagged-failure'

const causeWith = (error: unknown) => ({ reasons: [{ error }] })

describe('reading a named error out of a failed mutation', () => {
	describe('when the cause carries the error asked for', () => {
		it('should hand it back with its fields', () => {
			// GIVEN a cause holding a decoded API error
			const cause = causeWith({ _tag: 'BadRequest', message: 'no good' })
			// WHEN that tag is asked for
			// THEN the error comes back whole, so a screen can read its fields
			expect(taggedFailure(cause, 'BadRequest')).toEqual({
				_tag: 'BadRequest',
				message: 'no good',
			})
		})

		it('should find it among several reasons', () => {
			// GIVEN a cause with more than one reason
			const cause = {
				reasons: [
					{ error: { _tag: 'Other' } },
					{ error: { _tag: 'NotFound' } },
				],
			}
			// THEN the one asked for is found rather than only the first
			expect(taggedFailure(cause, 'NotFound')).toEqual({ _tag: 'NotFound' })
		})
	})

	describe('when it carries something else', () => {
		it('should answer nothing rather than guess', () => {
			// GIVEN a failure that is not the one being looked for
			// THEN nothing comes back, so the caller falls through to its own wording
			expect(taggedFailure(causeWith({ _tag: 'NotFound' }), 'BadRequest')).toBe(
				null,
			)
		})
	})

	describe('when the cause is not the shape it expects', () => {
		it('should answer nothing rather than throw', () => {
			// GIVEN causes that are missing, primitive, or shaped differently — all
			// of which reach here from a fault rather than a declared error
			expect(taggedFailure(null, 'BadRequest')).toBe(null)
			expect(taggedFailure('boom', 'BadRequest')).toBe(null)
			expect(taggedFailure({}, 'BadRequest')).toBe(null)
			expect(taggedFailure({ reasons: 'nope' }, 'BadRequest')).toBe(null)
			expect(taggedFailure({ reasons: [null, 3] }, 'BadRequest')).toBe(null)
			expect(taggedFailure(causeWith(null), 'BadRequest')).toBe(null)
		})
	})
})

describe('the sentence the server sent when it turned a write away', () => {
	describe('when a refusal carries wording', () => {
		it('should hand back the sentence itself', () => {
			// GIVEN a refusal written for the reader
			const cause = causeWith({
				_tag: 'BadRequest',
				message: 'That does not look like a valid email: "nope".',
			})
			// THEN it can be shown as-is, instead of a generic "try again"
			expect(badRequestMessage(cause)).toBe(
				'That does not look like a valid email: "nope".',
			)
		})
	})

	describe('when there is no wording to show', () => {
		it('should answer nothing', () => {
			// GIVEN a refusal with an empty or missing message, or a different failure
			// THEN there is nothing to put on screen and the caller says so its own way
			expect(badRequestMessage(causeWith({ _tag: 'BadRequest' }))).toBe(null)
			expect(
				badRequestMessage(causeWith({ _tag: 'BadRequest', message: '' })),
			).toBe(null)
			expect(
				badRequestMessage(causeWith({ _tag: 'BadRequest', message: 7 })),
			).toBe(null)
			expect(badRequestMessage(causeWith({ _tag: 'NotFound' }))).toBe(null)
		})
	})
})
