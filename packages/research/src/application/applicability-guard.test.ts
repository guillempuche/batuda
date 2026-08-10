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
			// GIVEN a create (contacts) naming the company it belongs to, no subject_id
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: {
						name: 'Jane Doe',
						company_id: 'co-1',
						email: 'jane@acme.test',
					},
				},
			])
			// WHEN filtered — a create needs no existing subject of its own
			const result = filterApplicableProposals(findings, () => false)
			// THEN it survives
			expect(survivors(result)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})

		it('should keep a create whose company arrived wrapped with a page', () => {
			// GIVEN a run asked to pair each changed value with the page it came
			// from, which carries that habit over to the company it attaches a new
			// person to
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: {
						name: 'Jane Doe',
						company_id: { value: 'co-1', source_id: 'https://acme.es/team' },
					},
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN the person survives: the company is there, just wrapped — read flat
			// it would look like nobody at all, and every discovered person would go
			expect(survivors(result)).toHaveLength(1)
			expect(result.dropped).toBe(0)
		})

		it('should still drop a create whose wrapper holds no company', () => {
			// GIVEN the same wrapper with nothing inside it
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: {
						name: 'Jane Doe',
						company_id: { value: '', source_id: 'https://acme.es/team' },
					},
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN reading through the wrapper does not soften the rule it guards
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})

		it('should keep a create that names its company in camelCase', () => {
			// GIVEN the other spelling the apply path also accepts
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: { name: 'Jane Doe', companyId: 'co-1' },
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN both spellings count as naming the company
			expect(survivors(result)).toHaveLength(1)
		})

		it('should keep a person carrying no address at all', () => {
			// GIVEN somebody named on a page with no email or phone findable — the
			// name and the job title are the useful part on their own
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: {
						name: 'Jane Doe',
						company_id: 'co-1',
						role: 'Plant Manager',
					},
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN they survive to be reviewed
			expect(survivors(result)).toHaveLength(1)
		})

		it('should drop a create that names no company', () => {
			// GIVEN a new person with nothing to attach them to
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: { name: 'Jane Doe', email: 'jane@acme.test' },
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN it goes now, rather than failing in front of whoever clicks accept
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})

		it('should drop a create whose company is blank', () => {
			// GIVEN a company id that is only whitespace
			const findings = withProposals([
				{
					subject_table: 'contacts',
					operation: 'create',
					fields: { name: 'Jane Doe', company_id: '   ' },
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN a blank names no company
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})

		it('should drop a create for any table other than people', () => {
			// GIVEN a create aimed at companies, which the apply path cannot insert
			const findings = withProposals([
				{
					subject_table: 'companies',
					operation: 'create',
					fields: { name: 'Acme SL', company_id: 'co-1' },
				},
			])
			// WHEN filtered
			const result = filterApplicableProposals(findings, () => false)
			// THEN only a person can be created, so it is dropped
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
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

// The fields a surviving proposal would actually write, narrowed from unknown.
const fieldsOf = (proposal: unknown): Record<string, unknown> => {
	const fields = (proposal as { fields?: unknown }).fields
	if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
		throw new Error('proposal carries no fields object')
	}
	return fields as Record<string, unknown>
}

describe('filterApplicableProposals when an earlier check emptied a field', () => {
	describe('when one of several fields was emptied', () => {
		it('should take that field out and keep the rest', () => {
			// GIVEN a proposal whose email an earlier check could not support, so it
			// was replaced with nothing, beside an industry it could
			const findings = withProposals([
				{
					subject_table: 'companies',
					subject_id: 'co-1',
					fields: { industry: 'transport', email: null },
				},
			])

			// WHEN filtered against a live company
			const result = filterApplicableProposals(findings, () => true)

			// THEN the change still lands, carrying only the field it stands behind —
			// keeping the empty one would erase the address already on the record
			expect(survivors(result)).toHaveLength(1)
			expect(fieldsOf(survivors(result)[0])).toStrictEqual({
				industry: 'transport',
			})
			expect(result.emptiedFields).toBe(1)
			expect(result.dropped).toBe(0)
		})

		it('should read one level into the sourced shape a value travels in', () => {
			// GIVEN the per-field shape with its inner value emptied
			const findings = withProposals([
				{
					subject_table: 'companies',
					subject_id: 'co-1',
					fields: {
						email: { value: null, source_id: 'src_a' },
						industry: { value: 'transport', source_id: 'src_a' },
					},
				},
			])

			// WHEN filtered
			const result = filterApplicableProposals(findings, () => true)

			// THEN the emptied one is taken out, the real one stays
			expect(Object.keys(fieldsOf(survivors(result)[0]))).toStrictEqual([
				'industry',
			])
			expect(result.emptiedFields).toBe(1)
		})
	})

	describe('when every field was emptied', () => {
		it('should drop the proposal whole', () => {
			// GIVEN a proposal left with nothing it can stand behind
			const findings = withProposals([
				{
					subject_table: 'companies',
					subject_id: 'co-1',
					fields: { email: null, phone: undefined },
				},
			])

			// WHEN filtered
			const result = filterApplicableProposals(findings, () => true)

			// THEN there is nothing to offer, so it goes rather than sitting in the
			// review inbox as a change that would only clear two fields
			expect(survivors(result)).toHaveLength(0)
			expect(result.dropped).toBe(1)
		})
	})

	describe('when a field holds a legitimate falsy value', () => {
		it('should keep it — empty means absent, not zero or blank', () => {
			// GIVEN a priority of zero and an empty-string location
			const findings = withProposals([
				{
					subject_table: 'companies',
					subject_id: 'co-1',
					fields: { priority: 0, location: '' },
				},
			])

			// WHEN filtered
			const result = filterApplicableProposals(findings, () => true)

			// THEN neither is mistaken for an emptied field
			expect(survivors(result)).toHaveLength(1)
			expect(result.emptiedFields).toBe(0)
		})
	})
})
