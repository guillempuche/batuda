import { describe, expect, it } from 'vitest'

import { bindContactsToEntity } from './contact-entity-guard'

const TARGETS = {
	cores: ['acme'],
	words: ['acme'],
	domains: ['acme.es'],
	places: [],
}

describe('bindContactsToEntity, when a run about one company lists something that is not a person', () => {
	it('should drop the address, the number and the bare first name, and count them', () => {
		// GIVEN a profile's contacts as a run wrote them: a real person, a
		// mailbox, a phone number and a testimonial's first name
		const person = (name: string) => ({
			name,
			citations: [{ quote: `${name}, Acme`, source_id: 'https://acme.es' }],
		})
		const findings = {
			contacts: [
				person('Ana Puig'),
				person('info@acme.es'),
				person('+34 935 603 166'),
				person('Stéphane'),
			],
		}

		// WHEN bound to the company
		const result = bindContactsToEntity(findings, TARGETS)

		// THEN only the person stays, and the rest are counted apart from a
		// misfiling
		expect(
			(result.findings as { contacts: Array<{ name: string }> }).contacts.map(
				c => c.name,
			),
		).toEqual(['Ana Puig'])
		expect(result.droppedNotPerson).toBe(3)
		expect(result.dropped).toBe(0)
	})

	it('should drop it with no company to hold the people against either', () => {
		// GIVEN a run with no keys of its own — a scan row, or a company the run
		// could not pin down — listing a mailbox as a person
		const findings = {
			contacts: [
				{ name: 'Ana Puig', citations: [] },
				{ name: 'info@acme.es', citations: [] },
			],
		}

		// WHEN bound with nothing to hold a quote against
		const result = bindContactsToEntity(findings, null)

		// THEN the address goes all the same: it is not a person whoever it
		// belongs to
		expect(
			(result.findings as { contacts: Array<{ name: string }> }).contacts.map(
				c => c.name,
			),
		).toEqual(['Ana Puig'])
		expect(result.droppedNotPerson).toBe(1)
		expect(result.dropped).toBe(0)
	})
})
