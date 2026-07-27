import { Cause, Effect, Exit, Schema } from 'effect'
import { SqlError } from 'effect/unstable/sql'
import { describe, expect, it } from 'vitest'

import { TERMINAL_RESEARCH_STATUSES } from '@batuda/domain'

import {
	MaxWaitSeconds,
	pollAfterMs,
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

describe('MaxWaitSeconds', () => {
	describe('when the caller asks for a shorter wait', () => {
		it('should accept a whole number of seconds', () => {
			// GIVEN a caller whose own request times out sooner than the default
			// WHEN it asks to wait four seconds
			// THEN the value is taken
			expect(accepts(MaxWaitSeconds, 4)).toBe(true)
		})
	})

	describe('when the value could never be waited for', () => {
		it('should reject anything that is not a whole second of waiting', () => {
			// GIVEN a wait already in the past, no wait at all, a part-second, and
			// two values that are no count of seconds
			// WHEN each is offered
			// THEN each is refused at the boundary, so the call cannot come straight
			// back with a run that never had a chance to finish
			for (const value of [-5, 0, 1.7, Number.NaN, Number.POSITIVE_INFINITY]) {
				expect(accepts(MaxWaitSeconds, value)).toBe(false)
			}
		})
	})
})

describe('pollAfterMs', () => {
	describe('when the run has ended', () => {
		it('should say nothing for every status that ends a run', () => {
			// GIVEN each status a run can end on, including the ones that carry no
			// findings and the one a deletion leaves behind
			// WHEN the wait is asked for
			// THEN none of them gets one, so a caller reading the absent field stops
			// asking instead of checking a run that will never change again
			for (const status of TERMINAL_RESEARCH_STATUSES) {
				expect(pollAfterMs(status)).toBeUndefined()
			}
		})
	})

	describe('when the run has not started yet', () => {
		it('should ask for a shorter wait than a working run', () => {
			// GIVEN a run queued behind the few that run at once
			// WHEN the wait is asked for
			// THEN it is shorter than a working run's, because the only thing that
			// has to happen is a slot coming free
			const queued = pollAfterMs('queued')
			const running = pollAfterMs('running')
			expect(queued).toBe(15_000)
			expect(running).toBe(20_000)
			expect(queued).toBeLessThan(running as number)
		})
	})

	describe('when the run is working', () => {
		it('should ask for a wait on the order of one round of work', () => {
			// GIVEN a run part-way through, where a round takes roughly half a minute
			// WHEN the wait is asked for
			// THEN it is close to that, so a caller asks about as often as there is
			// something new to hear rather than burning turns on unchanged answers
			expect(pollAfterMs('running')).toBe(20_000)
		})

		it('should treat an unfamiliar status as still working', () => {
			// GIVEN a status this build does not know, which can only mean a run
			// still doing something
			// WHEN the wait is asked for
			// THEN one comes back, so a caller keeps checking rather than walking
			// away from a run that may still finish
			expect(pollAfterMs('paused')).toBe(20_000)
		})
	})
})
