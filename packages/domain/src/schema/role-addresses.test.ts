import { describe, expect, it } from 'vitest'

import { isRoleAddress } from './role-addresses'

describe('isRoleAddress', () => {
	describe('when the address is a shared mailbox', () => {
		it('should recognise the common role words', () => {
			// GIVEN mailboxes answered by whoever is on duty
			for (const address of [
				'info@acme.com',
				'hola@tallerpuig.cat',
				'sales@acme.co.uk',
				'contacte@empresa.cat',
				'no-reply@acme.com',
			]) {
				expect(isRoleAddress(address), address).toBe(true)
			}
		})

		it('should ignore case and a plus-tag', () => {
			// GIVEN the same mailbox written for a form and in capitals
			expect(isRoleAddress('Info+web@acme.com')).toBe(true)
			expect(isRoleAddress('SALES@ACME.COM')).toBe(true)
		})

		it('should ignore surrounding whitespace', () => {
			expect(isRoleAddress('  info@acme.com')).toBe(true)
		})
	})

	describe('when the address belongs to a person', () => {
		it('should not match a name', () => {
			// GIVEN real people, including one whose name contains a role word
			for (const address of [
				'dolors@tallerpuig.cat',
				'john.smith@acme.com',
				'infosys@acme.com',
				'sales.director@acme.com',
			]) {
				expect(isRoleAddress(address), address).toBe(false)
			}
		})
	})

	describe('when the value is not an address at all', () => {
		it('should say no rather than throw', () => {
			// GIVEN inputs a parser or a person might hand over
			for (const value of ['', 'info', '@acme.com', 'acme.com', '  ']) {
				expect(isRoleAddress(value), JSON.stringify(value)).toBe(false)
			}
		})
	})
})
