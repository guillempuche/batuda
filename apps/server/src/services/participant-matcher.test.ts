import { describe, it } from 'vitest'

describe('ParticipantMatcher', () => {
	describe('match (unit)', () => {
		// Unit-level assertions live in tests that exercise the pure decision tree.
		// The discriminated-union outcomes themselves are the service's real contract.

		it.todo(
			// GIVEN a contacts table where exactly one row has email = target (case-insensitive)
			// WHEN match({ email, createPolicy: anything }) runs
			// THEN the result is MatchedContact with that contact and its companyId
			'should return MatchedContact when exactly one contact row matches the email case-insensitively',
		)

		it.todo(
			// GIVEN two contacts share the same email (any casing)
			// WHEN match({ email, createPolicy: anything }) runs
			// THEN the result is Ambiguous with every matching candidate in updated_at DESC order
			'should return Ambiguous with all candidates when two contacts share the email',
		)

		it.todo(
			// GIVEN no contact matches but a company exists whose email/website domain matches
			// AND createPolicy = "never"
			// WHEN match runs
			// THEN the result is MatchedCompanyOnly with that companyId
			'should return MatchedCompanyOnly when no contact matches but a company domain does and policy is never',
		)

		it.todo(
			// GIVEN no contact and no company match
			// WHEN match runs
			// THEN the result is NoMatch carrying the lowercased email
			'should return NoMatch when neither contact nor company matches',
		)

		it.todo(
			// GIVEN no contact matches but a company domain does
			// AND createPolicy = "contact-only"
			// WHEN match runs
			// THEN a new contact is inserted and CreatedContact is returned with the new contactId
			'should return CreatedContact when createPolicy is contact-only and a company is found',
		)

		it.todo(
			// GIVEN the email has no @ (no domain to fall back on)
			// WHEN match runs
			// THEN the result is NoMatch without touching the companies table
			'should return NoMatch when the email string has no domain part',
		)
	})
})
