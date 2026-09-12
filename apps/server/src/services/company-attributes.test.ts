import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import type { DeclaredAttribute } from '@batuda/instructions'

import {
	attributeMergeFor,
	attributeProvenanceKey,
	researchAttributeCitations,
	researchAttributeEntries,
	researchAttributePatch,
	splitCompanyAttributes,
} from './company-attributes'

const declared = (
	...attributes: ReadonlyArray<DeclaredAttribute>
): ReadonlyMap<string, DeclaredAttribute> =>
	new Map(attributes.map(attribute => [attribute.key, attribute]))

const SITES: DeclaredAttribute = {
	key: 'site_count',
	kind: 'number',
	enumValues: null,
	unit: 'sites',
}
const FOUNDED: DeclaredAttribute = {
	key: 'founded_on',
	kind: 'date',
	enumValues: null,
	unit: null,
}
const FIT: DeclaredAttribute = {
	key: 'fit',
	kind: 'enum',
	enumValues: ['strong', 'no'],
	unit: null,
}

const RUN = '11111111-1111-4111-8111-111111111111'

describe('splitCompanyAttributes', () => {
	describe('when the bag carries neither attributes nor a run', () => {
		it('should hand every key back as a column', () => {
			// GIVEN an ordinary company write
			// THEN nothing is lifted out
			expect(splitCompanyAttributes({ name: 'Acme', taxId: 'B1' })).toEqual({
				columns: { name: 'Acme', taxId: 'B1' },
				attributes: undefined,
				researchId: undefined,
			})
		})
	})

	describe('when the bag carries attributes and a run', () => {
		it('should lift both out of the columns, and read the run only when it is text', () => {
			// GIVEN a write with values, a run id, and separately a run id that is not text
			// THEN the columns lose both keys and only the text run id is kept
			expect(
				splitCompanyAttributes({
					name: 'Acme',
					attributes: { site_count: 3 },
					researchId: RUN,
				}),
			).toEqual({
				columns: { name: 'Acme' },
				attributes: { site_count: 3 },
				researchId: RUN,
			})
			expect(
				splitCompanyAttributes({ attributes: {}, researchId: 42 }),
			).toEqual({
				columns: {},
				attributes: {},
				researchId: undefined,
			})
		})
	})

	describe('when a caller skipped the door', () => {
		it('should hand the bag on as it is, for the merge to judge', () => {
			// GIVEN a value of no known shape
			// THEN the split does not judge it
			expect(
				splitCompanyAttributes({ attributes: { site_count: [1, 2] } })
					.attributes,
			).toEqual({ site_count: [1, 2] })
		})
	})
})

describe('attributeMergeFor', () => {
	const context = { declared: declared(SITES), run: undefined }
	const refusal = (input: unknown) => {
		const exit = Effect.runSyncExit(attributeMergeFor(context, input))
		if (Exit.isSuccess(exit)) throw new Error('expected a refusal')
		return Cause.squash(exit.cause)
	}

	describe('when the values are not a map at all', () => {
		it('should refuse with no key named', () => {
			// GIVEN a list, a string and null where the map should be
			// THEN each is refused as the wrong kind, with no key to name
			for (const input of [[1], 'x', null])
				expect(refusal(input)).toMatchObject({
					reason: 'wrong_kind',
					key: null,
				})
		})
	})

	describe('when one value has no known shape', () => {
		it('should refuse and name the key', () => {
			// GIVEN a list under a declared key
			// THEN the refusal names that key
			expect(refusal({ site_count: [1, 2] })).toMatchObject({
				reason: 'wrong_kind',
				key: 'site_count',
			})
		})
	})

	describe('when nothing was sent', () => {
		it('should plan nothing', () => {
			// GIVEN no attributes on the write
			// THEN there is no merge to run
			expect(
				Effect.runSync(attributeMergeFor(context, undefined)),
			).toBeUndefined()
		})
	})
})

describe('researchAttributePatch', () => {
	describe('when the findings carry no attribute map', () => {
		it('should produce nothing and drop nothing', () => {
			// GIVEN findings without the map, or with something else under it
			// THEN there is nothing to land and nothing to report
			for (const raw of [undefined, null, 'x', [1]])
				expect(researchAttributePatch(declared(SITES), raw)).toEqual({
					values: {},
					dropped: [],
				})
		})
	})

	describe('when a key is no longer declared', () => {
		it('should drop it as undeclared before looking at its shape', () => {
			// GIVEN a grounded value under a retired key
			// THEN it is dropped for the key, not the shape
			expect(
				researchAttributePatch(declared(), {
					retired: { value: 1, source_id: 's1' },
				}),
			).toEqual({
				values: {},
				dropped: [{ key: 'retired', reason: 'undeclared' }],
			})
		})
	})

	describe('when a declared value cites no page', () => {
		it('should drop it as ungrounded, even when the value itself reads fine', () => {
			// GIVEN a bare value, a wrapper without a page, and a wrapper whose page is not text
			// THEN each is ungrounded
			for (const raw of [
				{ site_count: 3 },
				{ site_count: { value: 3 } },
				{ site_count: { value: 3, source_id: 7 } },
			])
				expect(researchAttributePatch(declared(SITES), raw).dropped).toEqual([
					{ key: 'site_count', reason: 'ungrounded' },
				])
		})
	})

	describe('when a grounded value does not read as the declared kind', () => {
		it('should drop it as wrong kind', () => {
			// GIVEN a number, a date and a choice that do not read
			// THEN each is dropped for its kind
			const all = declared(SITES, FOUNDED, FIT)
			const patch = researchAttributePatch(all, {
				site_count: { value: 'about 12', source_id: 's1' },
				founded_on: { value: '2024-02-30', source_id: 's1' },
				fit: { value: 'gigantic', source_id: 's1' },
			})
			expect(patch.values).toEqual({})
			expect(patch.dropped.map(entry => entry.reason)).toEqual([
				'wrong_kind',
				'wrong_kind',
				'wrong_kind',
			])
		})
	})

	describe('when a grounded value reads loosely as its kind', () => {
		it('should keep the canonical reading with the quote, and the date note only as text', () => {
			// GIVEN a number with a grouping space, a choice in capitals, and notes of mixed types
			// THEN the values are canonical and only text notes survive
			expect(
				researchAttributePatch(declared(SITES, FIT), {
					site_count: {
						value: '1 200',
						source_id: 's1',
						quote: 'twelve hundred sites',
						as_of: 5,
					},
					fit: { value: 'STRONG', source_id: 's2', as_of: '2026-01-02' },
				}),
			).toEqual({
				values: {
					site_count: {
						value: 1200,
						sourceId: 's1',
						quote: 'twelve hundred sites',
					},
					fit: { value: 'strong', sourceId: 's2', asOf: '2026-01-02' },
				},
				dropped: [],
			})
		})
	})

	describe('when the notes are longer or looser than a person may send', () => {
		it('should cut the quote to its cap and drop a date that names no day', () => {
			// GIVEN a quote past the cap and a date written as a season
			const patch = researchAttributePatch(declared(SITES), {
				site_count: {
					value: 3,
					source_id: 's1',
					quote: 'q'.repeat(600),
					as_of: 'last spring',
				},
			})
			// THEN the quote is kept to the cap and the date is gone
			expect(patch.values['site_count']).toEqual({
				value: 3,
				sourceId: 's1',
				quote: 'q'.repeat(500),
			})
		})
	})

	describe('when the keys are mixed', () => {
		it('should keep the good one and report every drop with its reason', () => {
			// GIVEN one of each
			const patch = researchAttributePatch(declared(SITES, FIT), {
				site_count: { value: 3, source_id: 's1' },
				gone: { value: 1, source_id: 's1' },
				fit: 'strong',
			})
			// THEN one lands and two are reported
			expect(Object.keys(patch.values)).toEqual(['site_count'])
			expect(patch.dropped).toEqual([
				{ key: 'gone', reason: 'undeclared' },
				{ key: 'fit', reason: 'ungrounded' },
			])
		})
	})
})

describe('researchAttributeCitations', () => {
	describe('when a patch holds values', () => {
		it('should file each citation under the provenance key, with the date only when there is one', () => {
			// GIVEN two values, one dated
			// THEN each citation sits under attributes.<key>
			expect(
				researchAttributeCitations({
					values: {
						site_count: { value: 3, sourceId: 's1', asOf: '2026-01-02' },
						fit: { value: 'strong', sourceId: 's2' },
					},
					dropped: [],
				}),
			).toEqual({
				'attributes.site_count': { sourceId: 's1', asOf: '2026-01-02' },
				'attributes.fit': { sourceId: 's2' },
			})
		})
	})
})

describe('researchAttributeEntries', () => {
	const patch = {
		values: {
			site_count: {
				value: 3,
				sourceId: 's1',
				quote: 'three sites',
				asOf: '2026-01-02',
			},
			fit: { value: 'strong', sourceId: 's2' },
		},
		dropped: [],
	}
	const sources = {
		[attributeProvenanceKey('site_count')]: {
			sourceUrl: 'https://acme.es/sites',
			runId: RUN,
		},
	}

	describe('when a value landed on a page the run fetched', () => {
		it('should stamp the page address, the notes, the run and who set it, and name the unfetched key', () => {
			// GIVEN one value whose page resolved and one whose did not
			// THEN only the first is an entry, with the address rather than the
			// run's id, and the second is reported as unfetched
			expect(researchAttributeEntries(patch, sources, RUN, {})).toEqual({
				entries: {
					site_count: {
						value: 3,
						source_url: 'https://acme.es/sites',
						quote: 'three sites',
						as_of: '2026-01-02',
						research_id: RUN,
						set_by: 'research',
					},
				},
				held: [],
				unfetched: ['fit'],
			})
		})
	})

	describe('when the row already holds the key', () => {
		it('should leave a value a person set alone and say so, and replace one an earlier run set', () => {
			// GIVEN the key held by a person, then by an older run
			// THEN the person's word stays and is counted as held; the run's is replaced
			const byPerson = researchAttributeEntries(patch, sources, RUN, {
				site_count: { value: 9, set_by: 'client' },
			})
			expect(byPerson.entries).toEqual({})
			expect(byPerson.held).toEqual(['site_count'])
			const replaced = researchAttributeEntries(patch, sources, RUN, {
				site_count: { value: 2, set_by: 'research', research_id: 'old' },
			})
			expect(replaced.entries['site_count']?.research_id).toBe(RUN)
			expect(replaced.held).toEqual([])
		})

		it("should not read a bare or malformed stored value as a person's", () => {
			// GIVEN a column that is not a map, and a key holding a bare number
			// THEN the value still lands
			expect(
				Object.keys(
					researchAttributeEntries(patch, sources, RUN, null).entries,
				),
			).toEqual(['site_count'])
			expect(
				Object.keys(
					researchAttributeEntries(patch, sources, RUN, { site_count: 3 })
						.entries,
				),
			).toEqual(['site_count'])
		})
	})
})
