import { Cause } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	attachOutcome,
	cancelOutcome,
	clampPagination,
	computeResearchCacheKey,
	normalizeResearchQuery,
	researchCacheTtlDaysFor,
	schemaVersionFor,
	shouldMarkRunFailed,
} from './research-service'

describe('normalizeResearchQuery', () => {
	it('should collapse whitespace and lowercase so equivalent phrasings share a cache key', () => {
		// GIVEN two queries that differ only in case and whitespace
		const a = normalizeResearchQuery('  Ports of Barcelona  ')
		const b = normalizeResearchQuery('ports of\tbarcelona')
		const c = normalizeResearchQuery('ports    of  Barcelona')

		// THEN all three normalize to the same canonical form
		expect(a).toBe('ports of barcelona')
		expect(a).toBe(b)
		expect(a).toBe(c)
	})

	it('should preserve meaningful content between words', () => {
		// GIVEN a query with numbers and punctuation
		// THEN punctuation is kept — only whitespace and case are normalized
		expect(normalizeResearchQuery('Q3 2025 revenue?')).toBe('q3 2025 revenue?')
	})
})

describe('schemaVersionFor', () => {
	it('should extract a trailing _vN suffix as the schema version', () => {
		// GIVEN a schema name with an explicit version suffix
		// THEN the number is lifted into the cache key
		expect(schemaVersionFor('company_brief_v3')).toBe(3)
		expect(schemaVersionFor('person_profile_v1')).toBe(1)
	})

	it('should default to version 1 when the schema name carries no suffix', () => {
		// GIVEN a schema without a version marker
		// THEN the default version is 1 — consistent with first-defined schemas
		expect(schemaVersionFor('company_brief')).toBe(1)
		expect(schemaVersionFor('freeform')).toBe(1)
	})
})

describe('researchCacheTtlDaysFor', () => {
	it('should give freeform briefs a short 7-day TTL', () => {
		// GIVEN a freeform brief (no schema)
		// THEN the TTL is 7 days — editorial freshness matters
		expect(researchCacheTtlDaysFor('freeform')).toBe(7)
		expect(researchCacheTtlDaysFor(null)).toBe(7)
		expect(researchCacheTtlDaysFor(undefined)).toBe(7)
	})

	it('should give structured schemas a 30-day TTL', () => {
		// GIVEN a structured schema — invalidation is controlled by schema_version
		// THEN the TTL extends to 30 days
		expect(researchCacheTtlDaysFor('company_brief_v1')).toBe(30)
		expect(researchCacheTtlDaysFor('person_profile_v2')).toBe(30)
	})
})

describe('computeResearchCacheKey', () => {
	it('should produce the same key for identical inputs issued in a different order', () => {
		// GIVEN a user issuing the same research twice with subjects listed in reverse
		const a = computeResearchCacheKey({
			userId: 'u1',
			query: 'Ports of Barcelona',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: [
				{ table: 'companies', id: 'c2' },
				{ table: 'companies', id: 'c1' },
			],
			hints: { lang: 'ca' },
		})
		const b = computeResearchCacheKey({
			userId: 'u1',
			query: '  ports of BARCELONA',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: [
				{ table: 'companies', id: 'c1' },
				{ table: 'companies', id: 'c2' },
			],
			hints: { lang: 'ca' },
		})

		// THEN the normalized + sorted key matches — second call is a cache hit
		expect(a).toBe(b)
	})

	it('should scope keys per user so user A never serves user B a cached result', () => {
		// GIVEN identical inputs from two different users
		const same = {
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: undefined,
			hints: undefined,
		}
		const a = computeResearchCacheKey({ userId: 'u1', ...same })
		const b = computeResearchCacheKey({ userId: 'u2', ...same })

		// THEN the keys differ — user scope is baked into the hash
		expect(a).not.toBe(b)
	})

	it('should invalidate the cache on schema_version bump', () => {
		// GIVEN the same query but schema_version 1 vs 2
		const v1 = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: undefined,
			hints: undefined,
		})
		const v2 = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 2,
			subjects: undefined,
			hints: undefined,
		})

		// THEN bumping the version produces a miss — old rows are ignored
		expect(v1).not.toBe(v2)
	})

	it('should produce the same key when hint keys are listed in a different order', () => {
		// GIVEN two callers that pass equivalent hints with keys in different orders
		const a = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: undefined,
			hints: { lang: 'ca', depth: 2, tone: 'formal' },
		})
		const b = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: undefined,
			hints: { tone: 'formal', depth: 2, lang: 'ca' },
		})

		// THEN the keys collide — hints are serialized via a stable-key walker
		// (plain JSON.stringify preserves insertion order and would miss here)
		expect(a).toBe(b)
	})

	it('should be sensitive to hint changes so prompt-level tweaks bypass the cache', () => {
		// GIVEN the same query with different language hints
		const ca = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: undefined,
			hints: { lang: 'ca' },
		})
		const es = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			templateFingerprint: '',
			schemaVersion: 1,
			subjects: undefined,
			hints: { lang: 'es' },
		})

		// THEN switching the hint language misses the cache
		expect(ca).not.toBe(es)
	})

	it('should change the key when the template fingerprint changes', () => {
		// GIVEN the same request resolved against different template stacks
		const base = {
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			schemaVersion: 1,
			subjects: undefined,
			hints: undefined,
		}
		const withA = computeResearchCacheKey({
			...base,
			templateFingerprint: 'fpA',
		})
		const withB = computeResearchCacheKey({
			...base,
			templateFingerprint: 'fpB',
		})
		const none = computeResearchCacheKey({ ...base, templateFingerprint: '' })
		const noneAgain = computeResearchCacheKey({
			...base,
			templateFingerprint: '',
		})

		// THEN an edited or swapped stack misses the prior cache, while an
		// unchanged (or absent) instruction layer keeps the same key
		expect(withA).not.toBe(withB)
		expect(withA).not.toBe(none)
		expect(none).toBe(noneAgain)
	})
})

describe('shouldMarkRunFailed', () => {
	describe('when the run ended with a typed failure', () => {
		it('should mark the run failed', () => {
			// GIVEN a Fail cause (an LLM or SQL error reaching the terminal handler)
			// [research-service.ts — Effect.catchCause(cause => shouldMarkRunFailed(cause) ? …)]
			const cause = Cause.fail(new Error('llm provider failed'))

			// WHEN deciding whether to record the run as failed
			// THEN it is recorded as failed
			expect(shouldMarkRunFailed(cause)).toBe(true)
		})
	})

	describe('when the run ended with a defect (an unexpected crash)', () => {
		it('should mark the run failed', () => {
			// GIVEN a Die cause (an unexpected throw, not a typed error)
			const cause = Cause.die(new Error('boom'))

			// THEN it is still recorded as failed
			expect(shouldMarkRunFailed(cause)).toBe(true)
		})
	})

	describe('when the run was interrupted (cancelled or shut down)', () => {
		it('should not mark the run failed, so the cancellation status stands', () => {
			// GIVEN a pure interrupt cause (cancel / graceful shutdown)
			const cause = Cause.interrupt()

			// WHEN deciding
			// THEN the run is left alone — overwriting it with 'failed' would be wrong
			expect(shouldMarkRunFailed(cause)).toBe(false)
		})
	})
})

describe('clampPagination', () => {
	describe('when no limit or offset is given', () => {
		it('should fall back to the default page size and a zero offset', () => {
			// GIVEN no pagination filters
			// WHEN clamping
			const { limit, offset } = clampPagination(undefined, undefined)

			// THEN the prior query defaults stand
			expect(limit).toBe(20)
			expect(offset).toBe(0)
		})
	})

	describe('when the limit is below the floor', () => {
		it('should raise a negative or zero limit to 1 so SQL never sees LIMIT < 1', () => {
			// GIVEN limits Postgres would reject as `LIMIT -1` / `LIMIT 0`
			// THEN they are floored at the minimum of 1
			expect(clampPagination(-1, 0).limit).toBe(1)
			expect(clampPagination(0, 0).limit).toBe(1)
		})
	})

	describe('when the limit is above the ceiling', () => {
		it('should cap an oversized limit at 100 so one call cannot pull the whole table', () => {
			// GIVEN an absurdly large limit
			// THEN it is capped at the page-size ceiling
			expect(clampPagination(10_000_000, 0).limit).toBe(100)
		})
	})

	describe('when the limit is within range', () => {
		it('should pass a sensible page size through unchanged', () => {
			// GIVEN a limit inside [1, 100]
			// THEN it is preserved
			expect(clampPagination(50, 0).limit).toBe(50)
		})
	})

	describe('when the offset is negative', () => {
		it('should floor it at 0, since a negative OFFSET is meaningless', () => {
			// GIVEN a negative offset
			// THEN it is floored to 0
			expect(clampPagination(20, -5).offset).toBe(0)
		})
	})

	describe('when the offset is a valid position', () => {
		it('should pass it through unchanged', () => {
			// GIVEN a non-negative offset
			// THEN it is preserved
			expect(clampPagination(20, 40).offset).toBe(40)
		})
	})
})

describe('cancelOutcome', () => {
	describe('when a queued/running row flipped to cancelled', () => {
		it('should report a real cancellation', () => {
			// GIVEN the UPDATE … RETURNING matched a row
			// THEN the run was genuinely cancelled
			expect(cancelOutcome(true, true)).toBe('cancelled')
		})
	})

	describe('when nothing flipped but the run exists', () => {
		it('should report it as already in a terminal state', () => {
			// GIVEN no row flipped, but the run is present (already finished)
			// THEN cancelling is a no-op on a terminal run
			expect(cancelOutcome(false, true)).toBe('already_terminal')
		})
	})

	describe('when nothing flipped and the run is absent', () => {
		it('should report not_found instead of a false success', () => {
			// GIVEN no row flipped and no run with that id
			// THEN the caller learns it does not exist (the F7 bug)
			expect(cancelOutcome(false, false)).toBe('not_found')
		})
	})
})

describe('attachOutcome', () => {
	describe('when the subject does not exist', () => {
		it('should refuse at the subject, preventing an orphan link', () => {
			// GIVEN no company/contact with that id (the F3 bug)
			// THEN the attach is rejected before the run is even considered
			expect(attachOutcome(false, false)).toBe('subject_not_found')
			expect(attachOutcome(false, true)).toBe('subject_not_found')
		})
	})

	describe('when the subject exists but the run does not', () => {
		it('should report the run as not found', () => {
			// GIVEN a real subject but no such run
			// THEN the attach is rejected at the run
			expect(attachOutcome(true, false)).toBe('run_not_found')
		})
	})

	describe('when both the subject and run exist', () => {
		it('should attach the link', () => {
			// GIVEN both rows present
			// THEN the link may be written
			expect(attachOutcome(true, true)).toBe('attached')
		})
	})
})

// ── Fiber-level behaviors (integration) ──
// These exercise runFiber against stub providers + real Postgres. They require
// `pnpm cli services up`, the 0001 migration applied, and the three tier-LLM
// stubs wired through the layer composition. Scaffolded here so the BDD intent
// stays visible — wire up fixtures in the integration-test harness.
describe('research fiber (integration)', () => {
	it.todo(
		'should complete all three phases on the happy path with stub providers',
	)
	it.todo(
		'should set status to cancelled when the fiber is interrupted mid-phase',
	)
	it.todo(
		'should resume from checkpoint after a mid-phase restart (phase=1, research_text seeded)',
	)
	it.todo(
		'should short-circuit identical create() calls via research_cache (kind=cache_hit, cost_cents=0)',
	)
})

// ── Lifecycle guards (integration) ──
// Exercise the not-found / existence checks against real Postgres. Scaffolded
// so the BDD intent stays visible — wire fixtures in the integration harness.
describe('research lifecycle (integration)', () => {
	it.todo(
		'should report outcome=not_found when cancelling a run id with no queued/running row',
	)
	it.todo(
		'should report outcome=already_terminal when cancelling a run that already finished',
	)
	it.todo(
		'should refuse to attach a run to a company or contact that does not exist, writing no research_links row',
	)
})
