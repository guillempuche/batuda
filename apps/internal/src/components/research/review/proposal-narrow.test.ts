import { describe, expect, it } from 'vitest'

import { narrowProposedUpdates, strongestChannelTrust } from './proposal-narrow'

// One proposal exactly as a run stores it: the research schema's own names,
// with the CRM change under `fields`.
const proposal = (over: Record<string, unknown> = {}) => ({
	id: 'pu-1',
	status: 'pending',
	operation: 'create',
	subject_table: 'contacts',
	subject_id: 'contact-1',
	expected_version: 3,
	reason: 'Discovered CEO with a verified email.',
	fields: {
		name: 'Nuria Vidal',
		company_id: 'company-1',
		role: 'Head Chef',
		channels: [
			{
				kind: 'email',
				value: 'nuria@calpepfonda.cat',
				verification: 'deliverable',
				confidence: 0.9,
				is_primary: true,
			},
		],
	},
	citations: [{ source_id: 'https://calpepfonda.cat/equip', quote: 'CEO' }],
	...over,
})

describe('narrowProposedUpdates', () => {
	describe('when given a proposal in the shape a run stores', () => {
		it('should read the subject, version, channels and citations', () => {
			// GIVEN one stored proposal
			// WHEN narrowed for the review screen
			const [p] = narrowProposedUpdates([proposal()])

			// THEN every part the reviewer acts on is carried through
			expect(p?.subjectTable).toBe('contacts')
			expect(p?.subjectId).toBe('contact-1')
			expect(p?.expectedVersion).toBe(3)
			expect(p?.name).toBe('Nuria Vidal')
			expect(p?.citations).toEqual([
				{ sourceId: 'https://calpepfonda.cat/equip', quote: 'CEO' },
			])
			expect(p?.channels[0]?.isPrimary).toBe(true)
		})

		it('should keep the owning company out of the visible changes', () => {
			// GIVEN a proposal whose fields carry the company reference the reviewer
			// never acts on, alongside a real change
			// WHEN narrowed
			const [p] = narrowProposedUpdates([proposal()])

			// THEN the reference is hidden and only the real change is listed
			const labels = p?.scalarFields.map(([label]) => label) ?? []
			expect(labels).not.toContain('Company id')
			expect(p?.scalarFields).toEqual([['Role', 'Head Chef']])
		})

		it('should hide the company reference under either spelling', () => {
			// GIVEN the same reference spelled the other way — the model writes
			// these names itself, so both spellings turn up in practice
			// WHEN narrowed
			const [p] = narrowProposedUpdates([
				proposal({
					fields: { companyId: 'company-1', role: 'Head Chef' },
				}),
			])

			// THEN it is hidden just the same
			expect(p?.scalarFields).toEqual([['Role', 'Head Chef']])
		})

		it('should label a two-word field in plain words, however it was spelled', () => {
			// GIVEN two proposals naming the same field in the two ways a model
			// writes it
			// WHEN narrowed
			const [snake] = narrowProposedUpdates([
				proposal({ fields: { buying_role: 'economic_buyer' } }),
			])
			const [camel] = narrowProposedUpdates([
				proposal({ fields: { buyingRole: 'economic_buyer' } }),
			])

			// THEN both read the same on screen, instead of showing a raw field name
			expect(snake?.scalarFields).toEqual([['Buying role', 'economic_buyer']])
			expect(camel?.scalarFields).toEqual([['Buying role', 'economic_buyer']])
		})
	})

	describe('when a proposal is missing its optional parts', () => {
		it('should fall back rather than drop the proposal', () => {
			// GIVEN a bare proposal: no subject, no version, no fields, no citations
			// WHEN narrowed
			const [p] = narrowProposedUpdates([{ id: 'pu-2' }])

			// THEN it survives with safe defaults so the reviewer still sees it
			expect(p?.id).toBe('pu-2')
			expect(p?.status).toBe('pending')
			expect(p?.operation).toBe('update')
			expect(p?.subjectTable).toBeNull()
			expect(p?.expectedVersion).toBeNull()
			expect(p?.channels).toEqual([])
			expect(p?.scalarFields).toEqual([])
			expect(p?.citations).toEqual([])
		})
	})

	describe('when given malformed rows', () => {
		it('should skip anything without an id', () => {
			// GIVEN a null, a non-object, a row with no id, and one good row
			// WHEN narrowed
			const out = narrowProposedUpdates([
				null,
				7,
				{ status: 'pending' },
				proposal(),
			])

			// THEN only the well-formed proposal survives
			expect(out).toHaveLength(1)
			expect(out[0]?.id).toBe('pu-1')
		})

		it('should skip a channel or citation that names nothing', () => {
			// GIVEN a channel with no value and a citation with no source
			// WHEN narrowed
			const [p] = narrowProposedUpdates([
				proposal({
					fields: { channels: [{ kind: 'email' }, null] },
					citations: [{ quote: 'no source' }],
				}),
			])

			// THEN neither is shown, so nothing renders as a blank contact point
			expect(p?.channels).toEqual([])
			expect(p?.citations).toEqual([])
		})
	})
})

describe('strongestChannelTrust', () => {
	describe('when a proposal carries several reachable channels', () => {
		it('should badge it with the best-verified email or phone', () => {
			// GIVEN a risky email and a deliverable one
			const [p] = narrowProposedUpdates([
				proposal({
					fields: {
						channels: [
							{ kind: 'email', value: 'a@x.com', verification: 'risky' },
							{ kind: 'email', value: 'b@x.com', verification: 'deliverable' },
						],
					},
				}),
			])

			// WHEN the proposal's trust signal is taken
			const trust = strongestChannelTrust(p?.channels ?? [])

			// THEN the strongest one speaks for the proposal
			expect(trust.verification).toBe('deliverable')
			expect(trust.machineCheckable).toBe(true)
		})
	})

	describe('when a proposal changes only plain fields', () => {
		it('should report nothing machine-checkable', () => {
			// GIVEN a proposal with no email or phone to verify
			const [p] = narrowProposedUpdates([
				proposal({ fields: { role: 'Head Chef' } }),
			])

			// WHEN the proposal's trust signal is taken
			const trust = strongestChannelTrust(p?.channels ?? [])

			// THEN there is no verdict to show
			expect(trust.verification).toBeNull()
			expect(trust.machineCheckable).toBe(false)
		})
	})
})
