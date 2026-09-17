import { describe, expect, it } from 'vitest'

import { filterApplicableProposals } from './applicability-guard'

describe('filterApplicableProposals, when the run also read attribute values', () => {
	it('should still drop a proposal with no fields of its own', () => {
		// GIVEN attribute values for the company on file beside a proposal that
		// would write nothing — the proposal that carries the attributes is made
		// after this check, once the run's last round has folded in what it read
		const findings = {
			attributes: {
				family_owned: { value: true, source_id: 'https://acme.es/about' },
			},
			proposed_updates: [
				{
					subject_table: 'companies',
					operation: 'update',
					subject_id: 'co-1',
					fields: {},
				},
			],
		}

		// WHEN filtered against a live company
		const result = filterApplicableProposals(findings, () => true)

		// THEN nothing survives to be reviewed, and the values stay where they are
		expect(
			(result.findings as { proposed_updates: unknown[] }).proposed_updates,
		).toHaveLength(0)
		expect(result.dropped).toBe(1)
		expect((result.findings as { attributes: unknown }).attributes).toEqual(
			findings.attributes,
		)
	})
})
