import { describe, expect, it } from 'vitest'

import {
	ATTRIBUTE_PROPOSAL_REASON,
	withAttributeProposal,
} from './attribute-proposal'

const COMPANY = { id: 'c1', version: 3 }
const ATTRIBUTES = {
	family_owned: {
		value: true,
		source_id: 'https://acme.es',
		quote: 'familiar',
	},
}

describe('withAttributeProposal', () => {
	describe('when the run read attributes for the company on file and proposed nothing', () => {
		it('should add an update proposal with no fields for that company', () => {
			// GIVEN findings with a value and no proposals at all
			const findings = { attributes: ATTRIBUTES }

			// WHEN the proposal is added
			const result = withAttributeProposal(findings, COMPANY, 'p1') as {
				proposed_updates: ReadonlyArray<Record<string, unknown>>
			}

			// THEN one proposal names the company, its version and the reason,
			// stamped as pending under the id it was given
			expect(result.proposed_updates).toEqual([
				{
					id: 'p1',
					status: 'pending',
					subject_table: 'companies',
					operation: 'update',
					subject_id: 'c1',
					expected_version: 3,
					fields: {},
					reason: ATTRIBUTE_PROPOSAL_REASON,
					citations: [],
				},
			])
		})

		it('should keep the proposals the model made and add its own after them', () => {
			// GIVEN a proposal to create a contact, which names no company row
			const create = {
				subject_table: 'contacts',
				operation: 'create',
				expected_version: null,
				fields: '{"name":"Ana Puig"}',
				reason: 'new',
				citations: [],
			}
			const findings = { attributes: ATTRIBUTES, proposed_updates: [create] }

			// WHEN the proposal is added
			const result = withAttributeProposal(
				findings,
				{ id: 'c1', version: null },
				'p2',
			) as { proposed_updates: ReadonlyArray<unknown> }

			// THEN both stand, the company's with a null version as on file
			expect(result.proposed_updates).toHaveLength(2)
			expect(result.proposed_updates[0]).toBe(create)
			expect(result.proposed_updates[1]).toMatchObject({
				subject_id: 'c1',
				expected_version: null,
			})
		})
	})

	describe('when nothing calls for a proposal', () => {
		it('should leave the findings as they are', () => {
			// GIVEN no company on file, no attributes, an empty map, findings that
			// are not an object, and a proposal that already names the company
			const named = {
				subject_table: 'companies',
				subject_id: 'c1',
				expected_version: 3,
				fields: '{"location":"Igualada"}',
				reason: 'moved',
				citations: [],
			}
			const cases: ReadonlyArray<[unknown, typeof COMPANY | undefined]> = [
				[{ attributes: ATTRIBUTES }, undefined],
				[{ enrichment: {} }, COMPANY],
				[{ attributes: {} }, COMPANY],
				['not findings', COMPANY],
				[{ attributes: ATTRIBUTES, proposed_updates: [named] }, COMPANY],
			]

			for (const [findings, company] of cases) {
				// WHEN the proposal is considered
				// THEN the same findings come back untouched
				expect(withAttributeProposal(findings, company, 'p3')).toBe(findings)
			}
		})
	})
})
