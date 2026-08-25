import { describe, expect, it } from 'vitest'

import {
	buildResearchContext,
	type ResearchRequest,
	type ResearchScope,
	researchRequestKey,
} from './research-request'

const emptyScope: ResearchScope = {
	location: '',
	language: '',
	filterStatus: '',
	filterIndustry: '',
	filterCountry: '',
	filterTags: '',
}

const request = (over: Partial<ResearchRequest> = {}): ResearchRequest => ({
	query: 'bakeries in Barcelona',
	schema: 'prospect_scan_v1',
	stackId: '',
	templateIds: [],
	context: undefined,
	...over,
})

describe('buildResearchContext', () => {
	describe('when the run is pinned to a company', () => {
		it('should name that company as the subject', () => {
			// GIVEN a run pinned to one company
			// THEN the context names it and nothing else
			expect(
				buildResearchContext({ ...emptyScope, companyId: 'company-1' }),
			).toEqual({ subjects: [{ table: 'companies', id: 'company-1' }] })
		})

		it('should fall back to a discovery run when the id is empty', () => {
			// GIVEN a company id that is present but blank, which names nobody
			// THEN it is read as no subject at all, and the filters decide the scope
			expect(
				buildResearchContext({
					...emptyScope,
					companyId: '',
					filterStatus: 'lead',
				}),
			).toEqual({
				selector: { table: 'companies', filter: { status: 'lead' } },
			})
		})

		it('should ignore discovery scope fields', () => {
			// GIVEN a pinned run that also carries stale discovery filters
			// WHEN the context is built
			// THEN the filters are left out — the subject decides the scope
			expect(
				buildResearchContext({
					...emptyScope,
					companyId: 'company-1',
					filterStatus: 'lead',
					location: 'Catalonia',
				}),
			).toEqual({ subjects: [{ table: 'companies', id: 'company-1' }] })
		})
	})

	describe('when the run is a discovery run', () => {
		it('should be undefined with nothing filled in', () => {
			// GIVEN no scope at all
			// THEN there is no context to send
			expect(buildResearchContext(emptyScope)).toBeUndefined()
		})

		it('should carry a selector for the filters that were filled in', () => {
			// GIVEN a stage and an industry
			// THEN both land under the selector filter
			expect(
				buildResearchContext({
					...emptyScope,
					filterStatus: 'lead',
					filterIndustry: 'hospitality',
				}),
			).toEqual({
				selector: {
					table: 'companies',
					filter: { status: 'lead', industry: 'hospitality' },
				},
			})
		})

		it('should carry hints for location and language', () => {
			// GIVEN steering hints but no filters
			// THEN only the hints section is present
			expect(
				buildResearchContext({
					...emptyScope,
					location: 'Catalonia',
					language: 'ca',
				}),
			).toEqual({ hints: { language: 'ca', location: 'Catalonia' } })
		})

		it('should split tags on commas and drop the blanks', () => {
			// GIVEN a tag list with padding and empty entries
			// THEN each tag is trimmed and the empties disappear
			expect(
				buildResearchContext({ ...emptyScope, filterTags: ' vip , , warm ,' }),
			).toEqual({
				selector: { table: 'companies', filter: { tags: ['vip', 'warm'] } },
			})
		})

		it('should leave out a tag list that is only separators', () => {
			// GIVEN a tag field holding nothing but commas and spaces
			// THEN no filter survives, so there is no context
			expect(
				buildResearchContext({ ...emptyScope, filterTags: ' , , ' }),
			).toBeUndefined()
		})

		it('should trim whitespace around free-text filters', () => {
			// GIVEN padded free text
			// THEN the padding is not sent
			expect(
				buildResearchContext({
					...emptyScope,
					filterIndustry: '  hospitality  ',
					filterCountry: ' ES ',
				}),
			).toEqual({
				selector: {
					table: 'companies',
					filter: { industry: 'hospitality', country: 'ES' },
				},
			})
		})

		it('should ignore free-text filters that are only whitespace', () => {
			// GIVEN fields that look filled but hold only spaces
			// THEN they count as empty
			expect(
				buildResearchContext({
					...emptyScope,
					filterIndustry: '   ',
					location: '   ',
				}),
			).toBeUndefined()
		})
	})
})

describe('researchRequestKey', () => {
	describe('when the same scope is built twice', () => {
		// The key is a JSON string, so it answers to the order the context puts its
		// keys in. Pinning the exact text here means reordering how the context is
		// assembled fails this test instead of quietly withdrawing quotes that
		// are still good.
		it('should lay the context out in a fixed order', () => {
			// GIVEN every filter and hint filled in
			// THEN the context serialises exactly this way, every time
			expect(
				JSON.stringify(
					buildResearchContext({
						companyId: undefined,
						location: 'Barcelona',
						language: 'ca',
						filterStatus: 'lead',
						filterIndustry: 'hospitality',
						filterCountry: 'ES',
						filterTags: 'vip',
					}),
				),
			).toBe(
				'{"selector":{"table":"companies","filter":{"status":"lead","industry":"hospitality","country":"ES","tags":["vip"]}},"hints":{"language":"ca","location":"Barcelona"}}',
			)
		})

		it('should not depend on the order the scope fields are written in', () => {
			// GIVEN the same values supplied through differently ordered objects
			// THEN both price the same request
			const one = researchRequestKey(
				request({
					context: buildResearchContext({
						...emptyScope,
						filterStatus: 'lead',
						filterIndustry: 'hospitality',
					}),
				}),
			)
			const other = researchRequestKey(
				request({
					context: buildResearchContext({
						filterIndustry: 'hospitality',
						filterStatus: 'lead',
						location: '',
						language: '',
						filterCountry: '',
						filterTags: '',
					}),
				}),
			)
			expect(one).toBe(other)
		})
	})

	describe('when nothing about the request has changed', () => {
		it('should be the same for two identical requests', () => {
			// GIVEN the same request assembled twice
			// THEN a quote taken against one still answers for the other
			expect(researchRequestKey(request())).toBe(researchRequestKey(request()))
		})

		it('should ignore whitespace around the question', () => {
			// GIVEN the same question with padding, which is trimmed before sending
			// THEN the quote still stands
			expect(
				researchRequestKey(request({ query: '  bakeries in Barcelona ' })),
			).toBe(researchRequestKey(request()))
		})
	})

	describe('when something that moves the price changes', () => {
		it('should change when the question changes', () => {
			// GIVEN a different question
			// THEN the earlier quote no longer applies
			expect(
				researchRequestKey(request({ query: 'butchers in Girona' })),
			).not.toBe(researchRequestKey(request()))
		})

		it('should change when the kind of research changes', () => {
			// GIVEN a different schema, which prices differently
			expect(
				researchRequestKey(request({ schema: 'company_enrichment_v1' })),
			).not.toBe(researchRequestKey(request()))
		})

		it('should change when the selector widens to more companies', () => {
			// GIVEN a stage filter covering a different set of companies — the case
			// that would otherwise start a bigger batch than the one approved
			const quoted = request({
				context: buildResearchContext({ ...emptyScope, filterStatus: 'lead' }),
			})
			const widened = request({
				context: buildResearchContext({
					...emptyScope,
					filterStatus: 'client',
				}),
			})
			expect(researchRequestKey(widened)).not.toBe(researchRequestKey(quoted))
		})

		it('should change when a filter is added to an existing selector', () => {
			// GIVEN the same stage plus an extra industry filter
			const quoted = request({
				context: buildResearchContext({ ...emptyScope, filterStatus: 'lead' }),
			})
			const narrowed = request({
				context: buildResearchContext({
					...emptyScope,
					filterStatus: 'lead',
					filterIndustry: 'hospitality',
				}),
			})
			expect(researchRequestKey(narrowed)).not.toBe(researchRequestKey(quoted))
		})

		it('should change when the run is pinned to a different company', () => {
			// GIVEN a different subject
			const first = request({
				context: buildResearchContext({ ...emptyScope, companyId: 'a' }),
			})
			const second = request({
				context: buildResearchContext({ ...emptyScope, companyId: 'b' }),
			})
			expect(researchRequestKey(second)).not.toBe(researchRequestKey(first))
		})

		it('should change when the instructions stack changes', () => {
			// GIVEN a different saved stack, which changes what the run does
			expect(researchRequestKey(request({ stackId: 'stack-9' }))).not.toBe(
				researchRequestKey(request()),
			)
		})

		it('should change when a template is added', () => {
			// GIVEN an extra template layered onto the run
			expect(researchRequestKey(request({ templateIds: ['t1'] }))).not.toBe(
				researchRequestKey(request()),
			)
		})

		it('should change when templates are reordered', () => {
			// GIVEN the same templates in a different order — order is the order the
			// instructions are layered in, so it is part of the request
			expect(
				researchRequestKey(request({ templateIds: ['t2', 't1'] })),
			).not.toBe(researchRequestKey(request({ templateIds: ['t1', 't2'] })))
		})

		it('should tell a scoped run apart from an unscoped one', () => {
			// GIVEN a request that gained a selector where it had none
			const unscoped = request({ context: undefined })
			const scoped = request({
				context: buildResearchContext({ ...emptyScope, filterStatus: 'lead' }),
			})
			expect(researchRequestKey(scoped)).not.toBe(researchRequestKey(unscoped))
		})
	})

	describe('when the same scope is reached by a different route', () => {
		it('should match a scope typed with padding', () => {
			// GIVEN one person typing a padded industry and another typing it clean,
			// THEN both are the same request, because both are sent the same way
			const padded = request({
				context: buildResearchContext({
					...emptyScope,
					filterIndustry: '  hospitality ',
				}),
			})
			const clean = request({
				context: buildResearchContext({
					...emptyScope,
					filterIndustry: 'hospitality',
				}),
			})
			expect(researchRequestKey(padded)).toBe(researchRequestKey(clean))
		})

		it('should match when a filter is cleared back to empty', () => {
			// GIVEN a filter typed and then removed again — the case where a
			// withdrawn quote should come back rather than stay withdrawn
			const before = request({ context: buildResearchContext(emptyScope) })
			const after = request({
				context: buildResearchContext({ ...emptyScope, filterIndustry: '' }),
			})
			expect(researchRequestKey(after)).toBe(researchRequestKey(before))
		})
	})
})
