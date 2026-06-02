import { Cause, Effect, Exit, Schema } from 'effect'
import { SqlError } from 'effect/unstable/sql'
import { describe, expect, it } from 'vitest'

import {
	ResearchQuery,
	redactDbErrors,
	SchemaNameParam,
	Uuid,
} from './_research-shared'

// True when the value passes the schema's validation (refinement checks included).
const accepts = (schema: Schema.Codec<unknown>, value: unknown): boolean =>
	Schema.is(schema)(value)

const A_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('Uuid', () => {
	describe('when the value is a well-formed UUID', () => {
		it('should accept it', () => {
			// GIVEN a canonical UUID
			// THEN it decodes
			expect(accepts(Uuid, A_UUID)).toBe(true)
		})
	})

	describe('when the value is an uppercase UUID', () => {
		it('should accept it, matching how Postgres parses either case', () => {
			// GIVEN a UUID in uppercase
			// THEN it still passes (Postgres accepts it too)
			expect(accepts(Uuid, A_UUID.toUpperCase())).toBe(true)
		})
	})

	describe('when the value is not a UUID', () => {
		it('should reject a malformed id before it can reach SQL', () => {
			// GIVEN ids Postgres would reject as an invalid uuid cast
			// THEN each is refused at the boundary, so no raw SqlError leaks
			expect(accepts(Uuid, 'abc-not-a-uuid')).toBe(false)
			expect(accepts(Uuid, '')).toBe(false)
			expect(accepts(Uuid, '123')).toBe(false)
		})
	})
})

describe('ResearchQuery', () => {
	describe('when the query is present and reasonably sized', () => {
		it('should accept it', () => {
			// GIVEN a normal prompt
			// THEN it decodes
			expect(accepts(ResearchQuery, 'Investiga Factorial')).toBe(true)
		})
	})

	describe('when the query is empty', () => {
		it('should reject it so no empty run is created', () => {
			// GIVEN an empty string
			// THEN it is refused
			expect(accepts(ResearchQuery, '')).toBe(false)
		})
	})

	describe('when the query length is at the boundary', () => {
		it('should accept input exactly at the 8000-char cap', () => {
			// GIVEN a prompt at the cap
			// THEN it still decodes
			expect(accepts(ResearchQuery, 'x'.repeat(8000))).toBe(true)
		})

		it('should reject oversized input that would waste provider spend', () => {
			// GIVEN a prompt one char past the cap
			// THEN it is refused
			expect(accepts(ResearchQuery, 'x'.repeat(8001))).toBe(false)
		})
	})
})

describe('SchemaNameParam', () => {
	describe('when the name is in the closed set', () => {
		it('should accept every registered schema name', () => {
			// GIVEN each schema the server can resolve
			// THEN all decode
			for (const name of [
				'freeform',
				'company_enrichment_v1',
				'competitor_scan_v1',
				'contact_discovery_v1',
				'prospect_scan_v1',
			]) {
				expect(accepts(SchemaNameParam, name)).toBe(true)
			}
		})
	})

	describe('when the name is unknown', () => {
		it('should reject it up front instead of creating a doomed run', () => {
			// GIVEN a schema name the registry does not define
			// THEN it is refused at the boundary
			expect(accepts(SchemaNameParam, 'bogus_schema_v9')).toBe(false)
		})
	})
})

describe('redactDbErrors', () => {
	const sqlError = () =>
		new SqlError.SqlError({
			reason: new SqlError.UnknownError({
				cause: 'boom',
				message: 'SELECT secret FROM users',
			}),
		})

	describe('when the wrapped effect fails with a SqlError', () => {
		it('should collapse it to a redacted defect that hides the driver error', () => {
			// GIVEN an effect failing with a SqlError carrying the raw statement
			const exit = Effect.runSyncExit(redactDbErrors(Effect.fail(sqlError())))

			// THEN the result is a defect with a generic message, and neither the
			// SQL statement nor the SqlError tag survives in the rendered cause
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				const rendered = Cause.pretty(exit.cause)
				expect(rendered).toContain('internal error')
				expect(rendered).not.toContain('SELECT secret')
				expect(rendered).not.toContain('SqlError')
			}
		})
	})

	describe('when the wrapped effect succeeds', () => {
		it('should pass the value through untouched', () => {
			// GIVEN a successful effect
			const exit = Effect.runSyncExit(redactDbErrors(Effect.succeed('ok')))

			// THEN the success is preserved
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) expect(exit.value).toBe('ok')
		})
	})
})
