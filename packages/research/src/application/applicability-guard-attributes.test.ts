import { describe, expect, it } from 'vitest'

import { filterApplicableProposals } from './applicability-guard'

const knowsAcme = (table: string, id: string) =>
	table === 'companies' && id === 'acme'

const proposal = (fields: Record<string, unknown>, operation = 'update') => ({
	subject_table: 'companies',
	operation,
	subject_id: 'acme',
	expected_version: 1,
	fields,
	reason: 'Attribute values read from the pages, for the company on file.',
	citations: [],
})

const survivors = (result: { findings: unknown }): unknown[] =>
	(result.findings as { proposed_updates: unknown[] }).proposed_updates

describe('filterApplicableProposals, when an update carries no fields', () => {
	describe('when the findings hold attribute values for the company', () => {
		it('should keep the update, since the values ride beside it', () => {
			// GIVEN attribute values and the proposal a run adds for them
			const findings = {
				attributes: { family_owned: { value: true, source_id: 'p' } },
				proposed_updates: [proposal({})],
			}

			// WHEN filtered against a resolver that knows the company
			const result = filterApplicableProposals(findings, knowsAcme)

			// THEN the proposal stands
			expect(survivors(result)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})
	})

	describe('when nothing rides beside it', () => {
		it('should drop the update as it always did', () => {
			// GIVEN no attribute values, or an empty map, or a create with no fields
			const cases = [
				{ proposed_updates: [proposal({})] },
				{ attributes: {}, proposed_updates: [proposal({})] },
				{
					attributes: { family_owned: { value: true } },
					proposed_updates: [proposal({}, 'create')],
				},
			]

			for (const findings of cases) {
				// WHEN filtered
				const result = filterApplicableProposals(findings, knowsAcme)
				// THEN nothing survives
				expect(survivors(result)).toHaveLength(0)
				expect(result.dropped).toBe(1)
			}
		})

		it('should still drop an empty update under a scan row', () => {
			// GIVEN attribute values on the findings and an empty update inside a row
			const findings = {
				attributes: { family_owned: { value: true, source_id: 'p' } },
				prospects: [{ name: 'Acme', proposed_updates: [proposal({})] }],
			}

			// WHEN filtered
			const result = filterApplicableProposals(findings, knowsAcme)

			// THEN the row's update goes: the values ride with the findings, not the row
			const rows = (
				result.findings as { prospects: Array<{ proposed_updates: unknown[] }> }
			).prospects
			expect(rows[0]?.proposed_updates).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})
})
