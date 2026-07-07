import { describe, expect, it } from 'vitest'

import { filterApplicableProposals } from './applicability-guard'

// A subject resolver that knows one real row and nothing else.
const onlyKnows = (table: string, id: string) => (t: string, i: string) =>
	t === table && i === id

const withProposals = (proposals: unknown[]) => ({
	enrichment: { citations: [] },
	proposed_updates: proposals,
})

const survivors = (result: { findings: unknown }): unknown[] =>
	(result.findings as { proposed_updates: unknown[] }).proposed_updates

describe('filterApplicableProposals', () => {
	describe('when an update targets a company that does not exist', () => {
		it('should drop it', () => {
			// GIVEN an update whose subject_id resolves to no live row
			const findings = withProposals([
				{
					subject_table: 'companies',
					operation: 'update',
					subject_id: 'not-a-real-id',
					fields: { website: 'https://x.test' },
				},
			])
			// WHEN filtered against a resolver that knows a different id
			const result = filterApplicableProposals(
				findings,
				onlyKnows('companies', 'real-id'),
			)
			// THEN the proposal is dropped and counted
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})

	describe('when an update resolves to a real row with values to write', () => {
		it('should keep it', () => {
			// GIVEN an update for a company that exists, carrying real fields
			const findings = withProposals([
				{
					subject_table: 'companies',
					operation: 'update',
					subject_id: 'real-id',
					fields: { website: 'https://acme.test' },
				},
			])
			// WHEN filtered against a resolver that knows that row
			const result = filterApplicableProposals(
				findings,
				onlyKnows('companies', 'real-id'),
			)
			// THEN the proposal survives untouched
			expect(survivors(result)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})
	})

	describe('when fields is not a usable object', () => {
		it('should drop an update whose fields is prose or empty', () => {
			// GIVEN two updates the model malformed: column names as a string, and {}
			const findings = withProposals([
				{
					subject_table: 'companies',
					operation: 'update',
					subject_id: 'real-id',
					fields: 'location, website',
				},
				{
					subject_table: 'companies',
					operation: 'update',
					subject_id: 'real-id',
					fields: {},
				},
			])
			// WHEN filtered (the subject exists, so only the fields disqualify them)
			const result = filterApplicableProposals(
				findings,
				onlyKnows('companies', 'real-id'),
			)
			// THEN both are dropped
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(2)
		})
	})

	describe('when a create carries a new row', () => {
		it('should keep a create with a fields object and no subject', () => {
			// GIVEN a create (contacts) with the new row in fields and no subject_id
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: { name: 'Jane Doe', email: 'jane@acme.test' },
				},
			])
			// WHEN filtered — a create needs no existing subject
			const result = filterApplicableProposals(findings, () => false)
			// THEN it survives
			expect(survivors(result)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})

		it('should drop a create whose fields is prose', () => {
			// GIVEN a create with malformed fields
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: 'a new contact',
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN it is dropped
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})

	describe('when a proposal omits its operation', () => {
		it('should treat a missing operation as an update needing a subject', () => {
			// GIVEN a proposal with no operation and an unresolvable subject
			const findings = withProposals([
				{
					subject_table: 'companies',
					subject_id: 'ghost',
					fields: { website: 'https://x.test' },
				},
			])
			// WHEN filtered against a resolver that does not know it
			const result = filterApplicableProposals(findings, () => false)
			// THEN it is dropped like any un-resolvable update
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})
})
