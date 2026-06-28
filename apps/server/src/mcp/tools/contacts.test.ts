import { describe, expect, it } from 'vitest'

import { primaryEmailFrom } from './contacts'

describe('primaryEmailFrom', () => {
	describe('when an explicit email field is supplied', () => {
		it('should use it even when channels also carry an email', () => {
			// GIVEN an explicit email and a different (primary) email channel
			// WHEN the canonical send address is chosen
			// THEN the explicit field wins — it is the caller's stated intent
			// [contacts.ts — `email ?? …`]
			expect(
				primaryEmailFrom('boss@acme.com', [
					{ kind: 'email', value: 'other@acme.com', is_primary: true },
				]),
			).toBe('boss@acme.com')
		})
	})

	describe('when no explicit email but channels include emails', () => {
		it('should prefer the primary email channel over an earlier one', () => {
			// GIVEN two email channels where the primary is not the first
			// THEN the primary one is chosen
			// [contacts.ts — find(kind==='email' && is_primary)]
			expect(
				primaryEmailFrom(undefined, [
					{ kind: 'email', value: 'first@acme.com' },
					{ kind: 'email', value: 'primary@acme.com', is_primary: true },
				]),
			).toBe('primary@acme.com')
		})

		it('should fall back to the first email channel when none is primary', () => {
			// GIVEN a social channel followed by two unflagged email channels
			// THEN the first email channel is chosen
			// [contacts.ts — find(kind==='email')]
			expect(
				primaryEmailFrom(undefined, [
					{ kind: 'linkedin', value: 'https://linkedin.com/in/x' },
					{ kind: 'email', value: 'first@acme.com' },
					{ kind: 'email', value: 'second@acme.com' },
				]),
			).toBe('first@acme.com')
		})
	})

	describe('when there is no usable email anywhere', () => {
		it('should return undefined for channels without any email', () => {
			// GIVEN only social/phone channels
			// THEN there is no canonical email to set
			expect(
				primaryEmailFrom(undefined, [
					{ kind: 'x', value: 'https://x.com/handle' },
					{ kind: 'phone', value: '+34000000000' },
				]),
			).toBeUndefined()
		})

		it('should return undefined with an empty channel list', () => {
			// GIVEN no email and an empty channels array
			expect(primaryEmailFrom(undefined, [])).toBeUndefined()
		})

		it('should return undefined when channels are omitted entirely', () => {
			// GIVEN neither an email nor a channels array
			// [contacts.ts — channels?.find(...) short-circuits on undefined]
			expect(primaryEmailFrom(undefined, undefined)).toBeUndefined()
		})
	})
})
