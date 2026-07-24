import { describe, expect, it } from 'vitest'

import type { EntityTargets } from './entity-guard'
import { scopeSearchQuery } from './search-query-scope'

// A representative target: "Acme Logistics" at acme.com, no place keys.
const acme: EntityTargets = {
	cores: ['acmelogistics'],
	words: ['acme'],
	domains: ['acme.com'],
	places: [],
}

describe('scopeSearchQuery', () => {
	describe('when the query has drifted off the target company', () => {
		it('should prepend the quoted company name to re-anchor it', () => {
			// GIVEN a query that names neither the company, its domain, nor a
			// distinctive word from it — the drift that makes a provider return
			// off-company pages
			// WHEN scoped to the target
			// THEN the company's quoted name leads the query so the provider stays on it
			expect(
				scopeSearchQuery({
					query: 'sheet metal fabrication number of employees',
					name: 'Acme Logistics',
					targets: acme,
				}),
			).toBe('"Acme Logistics" sheet metal fabrication number of employees')
		})

		it('should trim surrounding whitespace on both the name and the query', () => {
			// GIVEN a name and query padded with whitespace
			// WHEN scoped
			// THEN neither the anchor nor the query carries stray padding
			expect(
				scopeSearchQuery({
					query: '  industry sector  ',
					name: '  Acme Logistics  ',
					targets: acme,
				}),
			).toBe('"Acme Logistics" industry sector')
		})
	})

	describe('when the query already reaches the target company', () => {
		it('should leave a query that spells the full name untouched', () => {
			// GIVEN a query that already names the company (a strong match)
			// WHEN scoped
			// THEN it is returned unchanged — re-anchoring would only narrow it
			const query = 'Acme Logistics headquarters city'
			expect(
				scopeSearchQuery({ query, name: 'Acme Logistics', targets: acme }),
			).toBe(query)
		})

		it('should leave a query carrying the target domain untouched', () => {
			// GIVEN a query scoped with a site: filter on the company's own domain
			// WHEN scoped
			// THEN it already reaches the target, so it is unchanged
			const query = 'site:acme.com team'
			expect(
				scopeSearchQuery({ query, name: 'Acme Logistics', targets: acme }),
			).toBe(query)
		})

		it('should leave a query carrying only a distinctive word untouched', () => {
			// GIVEN a query with a distinctive word from the name but not the full name
			// (a weak match) — still on-target, so no anchor is needed
			// WHEN scoped
			// THEN it is unchanged
			const query = 'acme employee headcount'
			expect(
				scopeSearchQuery({ query, name: 'Acme Logistics', targets: acme }),
			).toBe(query)
		})

		it('should be idempotent — a second pass adds no second anchor', () => {
			// GIVEN a query already re-anchored by a prior pass
			// WHEN scoped again
			// THEN the name is now present (a strong match) so nothing is prepended
			const once = scopeSearchQuery({
				query: 'number of employees',
				name: 'Acme Logistics',
				targets: acme,
			})
			expect(
				scopeSearchQuery({
					query: once,
					name: 'Acme Logistics',
					targets: acme,
				}),
			).toBe(once)
		})
	})

	describe('when the run has no single target company', () => {
		it('should leave the query untouched for null targets', () => {
			// GIVEN a scan/freeform run that reports third parties (targets null)
			// WHEN scoped
			// THEN the query is never narrowed to a name
			const query = 'top metal fabrication shops in Ohio'
			expect(
				scopeSearchQuery({ query, name: 'Acme Logistics', targets: null }),
			).toBe(query)
		})

		it('should leave the query untouched for undefined targets', () => {
			// GIVEN a run whose context carries no targets at all
			// WHEN scoped
			// THEN the query is returned as-is
			const query = 'best CRM for job shops'
			expect(
				scopeSearchQuery({ query, name: 'Acme Logistics', targets: undefined }),
			).toBe(query)
		})
	})

	describe('when no usable company name is available', () => {
		it('should leave the query untouched for an undefined name', () => {
			// GIVEN targets but no display name to anchor with
			// WHEN scoped
			// THEN there is nothing to prepend, so the query is unchanged
			const query = 'industry sector'
			expect(scopeSearchQuery({ query, name: undefined, targets: acme })).toBe(
				query,
			)
		})

		it('should leave the query untouched for a blank name', () => {
			// GIVEN a name that is only whitespace
			// WHEN scoped
			// THEN it yields no anchor, so the query is unchanged
			const query = 'industry sector'
			expect(scopeSearchQuery({ query, name: '   ', targets: acme })).toBe(
				query,
			)
		})
	})
})
