import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	isSchemaName,
	resolveSchema,
	SchemaNameSchema,
	schemaFieldNames,
	schemaNameFor,
	schemaNames,
	schemaRegistry,
} from './index'

// Decode through the canonical JSON codec, the way the HTTP route and the MCP
// tools run a caller's schema_name.
const accepts = (name: unknown): boolean =>
	Schema.decodeUnknownExit(Schema.toCodecJson(SchemaNameSchema))(name)._tag ===
	'Success'

describe('schemaFieldNames', () => {
	describe('when a run fills in a company profile', () => {
		it('should name the people and the rest of the profile, not only the scalars', () => {
			// GIVEN the enrichment shape, whose people are the thing a run most often
			// comes back missing
			const names = schemaFieldNames('company_enrichment_v1')

			// THEN the agent is told they are wanted at all
			expect(names).toContain('contacts')
			expect(names).toContain('competitors')
			// AND the profile's own fields are named one by one, since each is a
			// separate thing to go and find out
			expect(names).toContain('enrichment.industry')
			expect(names).toContain('enrichment.country')
			// AND a field that is one of a fixed set of answers stays whole: there
			// is nothing inside a verdict to go and find
			expect(names).toContain('verdict')
			expect(names).toContain('verdict_rationale')
		})
	})

	describe('when a block sits behind an optional wrapper', () => {
		it('should open the block and leave the list closed', () => {
			// GIVEN a scan with both shapes at once: a list of competitors, and a
			// market summary that may be left out
			// THEN naming the block alone would say nothing about what goes in it,
			//      while the list is named without spelling out each entry — pinned
			//      exactly, so opening a list or closing a block both fail here
			expect(schemaFieldNames('competitor_scan_v1')).toEqual([
				'competitors',
				'market_summary.total_competitors_found',
				'market_summary.market_maturity',
				'market_summary.key_differentiators',
				'market_summary.citations',
			])
		})
	})

	describe('when a field is a list of repeated things', () => {
		it('should name the list without spelling out each entry', () => {
			// GIVEN a scan that comes back with many prospects
			// THEN knowing to go and find prospects is the useful part; each one's
			// own fields are a detail for whoever writes them down, and every extra
			// word competes for a small model's attention
			expect(schemaFieldNames('prospect_scan_v1')).toEqual(['prospects'])
			expect(schemaFieldNames('contact_discovery_v1')).toEqual(['contacts'])
		})
	})

	describe('when the run writes a brief rather than a profile', () => {
		it('should name nothing, so the prompt keeps its short form', () => {
			// GIVEN a freeform run, whose shape holds only the plumbing that hands
			// work back to the CRM
			expect(schemaFieldNames('freeform')).toEqual([])
		})
	})

	describe('when the schema is not one we know', () => {
		it('should return nothing rather than fail a run', () => {
			expect(schemaFieldNames('made_up_v9')).toEqual([])
		})
	})
})

describe('SchemaNameSchema', () => {
	describe('when a name is offered to the API boundary', () => {
		it('should accept every name a run can actually be resolved through', () => {
			// GIVEN the boundary is what refuses unknown names, while the registry is
			// what a run is resolved through
			// THEN a name accepted here but absent there would be a run that starts,
			// says so, and only then dies on a schema that was never going to resolve
			for (const name of schemaNames) {
				expect(accepts(name)).toBe(true)
				expect(resolveSchema(name)).toBeDefined()
			}
		})

		it('should hold every schema the registry defines, so none ships dark', () => {
			// GIVEN a schema the registry can resolve but the boundary refuses — it
			// runs over HTTP and is rejected over MCP, which is the drift a
			// hand-copied list allowed
			for (const name of Object.keys(schemaRegistry)) {
				expect(accepts(name)).toBe(true)
			}
		})

		it('should refuse a name the registry does not hold', () => {
			expect(accepts('bogus_schema_v9')).toBe(false)
			expect(accepts('')).toBe(false)
			expect(accepts('toString')).toBe(false)
		})
	})
})

describe('isSchemaName', () => {
	describe('when the name is one the registry holds', () => {
		it('should recognise every registered name', () => {
			// GIVEN the five shapes a run can come back in
			for (const name of schemaNames) {
				expect(isSchemaName(name)).toBe(true)
			}
		})
	})

	describe('when the name is not in the registry', () => {
		it('should reject a name that was never there', () => {
			expect(isSchemaName('made_up_v9')).toBe(false)
		})

		it('should reject the empty name', () => {
			expect(isSchemaName('')).toBe(false)
		})

		it('should not mistake a name every object carries for a schema', () => {
			// GIVEN names that live on every object rather than in the registry
			// THEN they are not schemas, so a run named after one is refused like any
			// other unknown name instead of resolving to a function
			expect(isSchemaName('toString')).toBe(false)
			expect(isSchemaName('constructor')).toBe(false)
			expect(isSchemaName('__proto__')).toBe(false)
		})
	})
})

describe('resolveSchema', () => {
	describe('when the name is one the registry holds', () => {
		it('should hand back the schema the registry stores under it', () => {
			// GIVEN a name read off a run row
			// THEN the run is shaped by exactly the schema that name refers to
			expect(resolveSchema('company_enrichment_v1')).toBe(
				schemaRegistry.company_enrichment_v1,
			)
			expect(resolveSchema('freeform')).toBe(schemaRegistry.freeform)
		})
	})

	describe('when the name no longer resolves', () => {
		it('should return nothing, so a retired schema is caught rather than run', () => {
			// GIVEN a run queued under a schema that has since been retired — the
			// name survives on its row long after the schema is gone
			// THEN the caller is handed nothing to run, rather than a stand-in
			expect(resolveSchema('retired_shape_v1')).toBeUndefined()
		})

		it('should return nothing for a name every object carries', () => {
			expect(resolveSchema('toString')).toBeUndefined()
			expect(resolveSchema('__proto__')).toBeUndefined()
		})
	})
})

describe('schemaNameFor', () => {
	describe('when the request says which kind of run it wants', () => {
		it('should take the caller at their word for every kind', () => {
			// GIVEN each kind a caller can ask for, alongside a shape that would have
			// implied a different one
			// WHEN the kind is settled
			// THEN what was asked for is what runs — the shape of the request never
			// overrules it
			for (const name of schemaNames) {
				expect(schemaNameFor({ schemaName: name })).toBe(name)
				expect(
					schemaNameFor({
						schemaName: name,
						context: { subjects: [{ table: 'companies', id: 'a' }] },
					}),
				).toBe(name)
			}
		})

		it('should still let a brief be asked for outright', () => {
			// GIVEN a question that fits no fixed shape, asked with nothing pinned —
			// the exact combination that used to happen by accident
			// THEN asking for it on purpose still works, because only silence is
			// being reinterpreted
			expect(schemaNameFor({ schemaName: 'freeform' })).toBe('freeform')
		})
	})

	describe('when the request asks about records already held', () => {
		it('should fill in the profile of a company that was named', () => {
			// GIVEN a request pinned to a company
			// THEN it is a question about that company, so its own card is what gets
			// filled in
			expect(
				schemaNameFor({
					context: { subjects: [{ table: 'companies', id: 'a' }] },
				}),
			).toBe('company_enrichment_v1')
		})

		it('should treat a filter over existing companies the same as naming them', () => {
			// GIVEN a filter, which picks out companies already here and researches
			// one at a time rather than asking for new ones
			// THEN it lands on the same kind naming them outright would
			expect(
				schemaNameFor({
					context: { selector: { table: 'companies', filter: {} } },
				}),
			).toBe('company_enrichment_v1')
		})

		it('should settle a filter and the companies it picks out on one kind', () => {
			// GIVEN the two shapes one filtered request passes through: the request
			// as it arrives, and each company it fans out to
			const asked = schemaNameFor({
				context: {
					selector: { table: 'companies', filter: { country: 'ES' } },
				},
			})
			const fannedOut = schemaNameFor({
				context: { subjects: [{ table: 'companies', id: 'a' }] },
			})

			// THEN both settle on the same kind. One of these keys the answer put
			// away for reuse and the other keys the lookup that finds it again, so
			// were they to disagree the run would never be reused at all
			expect(asked).toBe(fannedOut)
		})
	})

	describe('when the request asks for companies not held yet', () => {
		it('should go looking for companies rather than write about none', () => {
			// GIVEN a question with nothing pinned to it — go and find companies in
			// a sector
			// WHEN no kind was named
			// THEN it goes looking for them. Answering as a brief left the companies
			// nowhere to go, and every check for a thin result reads that list, so
			// an answer holding nothing reported itself a success
			expect(schemaNameFor({})).toBe('prospect_scan_v1')
		})

		it('should read an empty list of records as pinning nothing', () => {
			// GIVEN a request carrying the field but nothing in it
			// THEN it pins no company, so it is asking for ones not held yet
			expect(schemaNameFor({ context: { subjects: [] } })).toBe(
				'prospect_scan_v1',
			)
		})

		it('should read a context that says nothing at all the same way', () => {
			// GIVEN each way a request can carry no shape — absent, empty, or
			// explicitly nothing
			// THEN none of them pins anything, so all land together
			for (const context of [undefined, null, {}, { subjects: undefined }]) {
				expect(schemaNameFor({ context })).toBe('prospect_scan_v1')
			}
		})
	})

	describe('when the request names no kind', () => {
		it('should read every way of saying nothing as saying nothing', () => {
			// GIVEN the field left out, sent as nothing, or sent empty — an empty
			// name resolves to no schema, so treating it as a name would leave a run
			// that starts and then dies
			for (const schemaName of [undefined, null, '']) {
				expect(schemaNameFor({ schemaName })).toBe('prospect_scan_v1')
			}
		})
	})

	describe('when the kind named is not one this build has', () => {
		it('should hand the name back rather than quietly run something else', () => {
			// GIVEN a run queued under a kind that has since been retired, its name
			// still on the row
			// WHEN the kind is settled
			// THEN the name survives untouched, so the run still stops and says the
			// kind is gone — swapping in a working one would answer a question
			// nobody asked
			expect(schemaNameFor({ schemaName: 'retired_shape_v1' })).toBe(
				'retired_shape_v1',
			)
			expect(
				schemaNameFor({
					schemaName: 'retired_shape_v1',
					context: { subjects: [{ table: 'companies', id: 'a' }] },
				}),
			).toBe('retired_shape_v1')
		})
	})
})
