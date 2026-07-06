import { describe, expect, it } from 'vitest'

import { verifyValueProvenance } from './value-guard'

const proposals = (findings: unknown): Array<{ subject_id: string }> =>
	(findings as { proposed_updates: Array<{ subject_id: string }> })
		.proposed_updates

describe('verifyValueProvenance', () => {
	describe('when a proposed value appears in the evidence', () => {
		it('should keep the proposal, tolerating different formatting', () => {
			// GIVEN a scraped page that mentions the phone (differently punctuated)
			// and the email
			const corpus = 'Contact us at 404.555.0198 or sales@acme.es'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { phone: '(404) 555-0198', email: 'sales@acme.es' },
					},
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the proposal survives (digits + email both match)
			expect(proposals(result.findings)).toHaveLength(1)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when a proposed value appears nowhere in the evidence', () => {
		it('should drop the whole proposal', () => {
			// GIVEN a corpus that never mentions the invented phone
			const corpus = 'Acme is a logistics company based in Barcelona.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { phone: '(404) 555-0198' } },
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the fabricated CRM write is gone
			expect(proposals(result.findings)).toHaveLength(0)
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when an invented email is proposed', () => {
		it('should drop it even though a real email exists elsewhere', () => {
			// GIVEN the wrong-domain fabrication class from the prod bug
			const corpus = 'Reach the team at hello@acme.es'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { email: 'ceo@greenglobalshipping.com' },
					},
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN it is dropped
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when a proposal only carries fuzzy free-text fields', () => {
		it('should keep it — those are not checkable', () => {
			// GIVEN a proposal with only free text the guard cannot confirm or refute
			const corpus = 'Some unrelated text.'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: { industry: 'logistics', size_range: '50-200' },
					},
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN it survives (fuzzy fields are left alone)
			expect(proposals(result.findings)).toHaveLength(1)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when several proposals mix supported and invented values', () => {
		it('should drop only the unsupported ones', () => {
			// GIVEN a supported phone, an invented email, and a fuzzy-only proposal
			const corpus = 'Phone: 936 123 456. Email: info@acme.es'
			const findings = {
				proposed_updates: [
					{ subject_id: 'a', fields: { phone: '936123456' } },
					{ subject_id: 'b', fields: { email: 'fake@nowhere.io' } },
					{ subject_id: 'c', fields: { notes: 'friendly' } },
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN only the invented one is dropped
			expect(proposals(result.findings).map(p => p.subject_id)).toEqual([
				'a',
				'c',
			])
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when a short digit run (like a year) is the only value', () => {
		it('should keep it — short numbers are not treated as checkable ids', () => {
			// GIVEN a founded-year that is not a phone/tax-id-length number
			const corpus = 'No numbers of interest here.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { foundedYear: '2005' } },
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN it survives (a 4-digit year is not checked)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when findings carry no checkable values', () => {
		it('should return them unchanged', () => {
			// GIVEN descriptive-only findings with no email/phone to check
			const findings = { contacts: [{ name: 'Ada', role: 'CTO' }] }

			// WHEN checked
			const result = verifyValueProvenance(findings, 'anything')

			// THEN nothing is touched
			expect(result.findings).toEqual(findings)
			expect(result.droppedProposals).toBe(0)
			expect(result.strippedValues).toBe(0)
		})
	})

	describe('when a contact channel carries an invented email', () => {
		it('should drop that channel and keep the grounded ones', () => {
			// GIVEN a contact with one real and one invented email channel
			const corpus = 'Reach Ada at ada@acme.es'
			const findings = {
				contacts: [
					{
						name: 'Ada',
						channels: [
							{ kind: 'email', value: 'ada@acme.es' },
							{ kind: 'email', value: 'ceo@fake.io' },
							{ kind: 'linkedin', value: 'in/ada' },
						],
					},
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN only the invented email channel is gone; handle channels stay
			const channels = (
				result.findings as {
					contacts: Array<{ channels: Array<{ value: string }> }>
				}
			).contacts[0]?.channels
			expect(channels?.map(c => c.value)).toEqual(['ada@acme.es', 'in/ada'])
			expect(result.strippedValues).toBe(1)
		})
	})

	describe('when a descriptive email field is invented', () => {
		it('should blank it while keeping a grounded email elsewhere', () => {
			// GIVEN one invented and one grounded email in plain fields
			const corpus = 'Company email: hello@acme.es'
			const findings = {
				enrichment: { email: 'sales@nowhere.io', name: 'Acme' },
				other: { email: 'hello@acme.es' },
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the invented one is blanked, the grounded one survives
			const f = result.findings as {
				enrichment: { email: unknown; name: unknown }
				other: { email: unknown }
			}
			expect(f.enrichment.email).toBeNull()
			expect(f.enrichment.name).toBe('Acme')
			expect(f.other.email).toBe('hello@acme.es')
			expect(result.strippedValues).toBe(1)
		})
	})

	describe('when a create proposal references a company by id', () => {
		it('should keep it — a company_id UUID is structural, not a checkable value', () => {
			// GIVEN a create proposal whose grounded email is in the evidence but
			// whose company_id UUID (naturally) is not
			const corpus = 'Reach Ada at ada@acme.es'
			const findings = {
				proposed_updates: [
					{
						operation: 'create',
						subject_table: 'contacts',
						company_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
						fields: {
							name: 'Ada',
							company_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
							email: 'ada@acme.es',
						},
					},
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the proposal survives — the UUID is not read as an invented number
			expect(proposals(result.findings)).toHaveLength(1)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when a proposal carries an invented email in a nested channel', () => {
		it('should strip the channel but keep the grounded proposal', () => {
			// GIVEN a proposal whose fields are grounded but whose nested channels
			// mix a real and an invented email
			const corpus = 'Ada Lovelace, ada@acme.es'
			const findings = {
				proposed_updates: [
					{
						subject_id: 'c1',
						fields: {
							name: 'Ada',
							channels: [
								{ kind: 'email', value: 'ada@acme.es' },
								{ kind: 'email', value: 'ceo@fake.io' },
							],
						},
					},
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the proposal is kept and only the invented channel is gone
			const kept = proposals(result.findings) as unknown as Array<{
				fields: { channels: Array<{ value: string }> }
			}>
			expect(kept).toHaveLength(1)
			expect(kept[0]?.fields.channels.map(c => c.value)).toEqual([
				'ada@acme.es',
			])
			expect(result.strippedValues).toBe(1)
		})
	})

	describe('when a proposal emits its fields as prose instead of an object', () => {
		it('should drop it if the prose carries an invented email', () => {
			// GIVEN an open-weights model that put the fields in a free-text string
			const corpus = 'No contact details here.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: 'Best contact: ceo@fabricated.com' },
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the fabricated write is dropped, not passed through unchecked
			expect(proposals(result.findings)).toHaveLength(0)
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when a real phone is written with a country-code prefix', () => {
		it('should keep it — the corpus number is a suffix of the proposed one', () => {
			// GIVEN a page showing the local number and a proposal prefixing +1
			const corpus = 'Call us on (404) 555-0198.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { phone: '+1 404 555 0198' } },
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN it survives (country-code tolerance)
			expect(result.droppedProposals).toBe(0)
		})
	})

	describe('when a fabricated number only matches across two corpus numbers', () => {
		it('should drop it — digits match per number, not across boundaries', () => {
			// GIVEN two unrelated numbers whose concatenated digits would contain the
			// fabricated value only by spanning both
			const corpus = 'Phones: 111 222 3333 and 4444 555 666.'
			const findings = {
				proposed_updates: [
					{ subject_id: 'c1', fields: { tax_id: '33334444' } },
				],
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN it is dropped — no single corpus number matches
			expect(result.droppedProposals).toBe(1)
		})
	})

	describe('when a descriptive phone field is invented', () => {
		it('should blank it while keeping a grounded phone elsewhere', () => {
			// GIVEN one invented and one grounded phone in flat descriptive fields
			const corpus = 'Main line: 936 123 456.'
			const findings = {
				lead: { phone: '555 867 5309', name: 'Acme' },
				branch: { phone: '936 123 456' },
			}

			// WHEN checked
			const result = verifyValueProvenance(findings, corpus)

			// THEN the invented one is blanked, the grounded one survives
			const f = result.findings as {
				lead: { phone: unknown; name: unknown }
				branch: { phone: unknown }
			}
			expect(f.lead.phone).toBeNull()
			expect(f.lead.name).toBe('Acme')
			expect(f.branch.phone).toBe('936 123 456')
			expect(result.strippedValues).toBe(1)
		})
	})
})
