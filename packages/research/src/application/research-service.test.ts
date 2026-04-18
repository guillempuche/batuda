import { describe, expect, it } from 'vitest'

import {
	computeResearchCacheKey,
	normalizeResearchQuery,
	researchCacheTtlDaysFor,
	schemaVersionFor,
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
			schemaVersion: 1,
			subjects: undefined,
			hints: undefined,
		})
		const v2 = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
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
			schemaVersion: 1,
			subjects: undefined,
			hints: { lang: 'ca', depth: 2, tone: 'formal' },
		})
		const b = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
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
			schemaVersion: 1,
			subjects: undefined,
			hints: { lang: 'ca' },
		})
		const es = computeResearchCacheKey({
			userId: 'u1',
			query: 'q',
			schemaName: 'company_brief',
			schemaVersion: 1,
			subjects: undefined,
			hints: { lang: 'es' },
		})

		// THEN switching the hint language misses the cache
		expect(ca).not.toBe(es)
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
