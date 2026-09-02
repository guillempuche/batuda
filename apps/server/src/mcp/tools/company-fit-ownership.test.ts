import { Tool } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { CompanyTools } from './companies'

// The research engine owns a company's fit fields: a run writes them when its
// findings are applied, and nothing a person or an assistant calls sets them.
// The rule is written down beside the columns, but a rule only written down is
// one somebody adds a parameter past without noticing — so it is checked here,
// against the surface the server actually serves.
//
// Somebody's own view of whether a company is worth selling to lives under
// `metadata`; that is the field the write tools do offer.

// Every field name the tool accepts, at whatever depth it sits. Read as names
// rather than by searching the schema text, because the descriptions mention
// these fields on purpose and would match a text search.
const acceptedFieldNames = (toolName: string): ReadonlySet<string> => {
	// Reached by name so the check reads the served surface rather than a second
	// list kept beside it; the toolkit types its tools one by one, so the lookup
	// goes through `unknown` rather than asserting a shape it does not have.
	const tools = CompanyTools.tools as unknown as Record<string, Tool.Any>
	const tool = tools[toolName]
	if (tool === undefined) throw new Error(`no company tool named ${toolName}`)
	const names = new Set<string>()
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) walk(child)
			return
		}
		if (typeof node !== 'object' || node === null) return
		const record = node as Record<string, unknown>
		const properties = record['properties']
		if (typeof properties === 'object' && properties !== null)
			for (const key of Object.keys(properties)) names.add(key)
		for (const value of Object.values(record)) walk(value)
	}
	walk(Tool.getJsonSchema(tool))
	return names
}

// What a client is actually told about one field, as published rather than as
// written in the source — a description that never reaches the schema helps
// nobody.
const fieldDescription = (toolName: string, field: string): string => {
	const tools = CompanyTools.tools as unknown as Record<string, Tool.Any>
	const tool = tools[toolName]
	if (tool === undefined) throw new Error(`no company tool named ${toolName}`)
	let found = ''
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) walk(child)
			return
		}
		if (typeof node !== 'object' || node === null) return
		const record = node as Record<string, unknown>
		const properties = record['properties']
		if (typeof properties === 'object' && properties !== null) {
			const entry = (properties as Record<string, unknown>)[field]
			if (typeof entry === 'object' && entry !== null) {
				const described = (entry as { description?: unknown }).description
				if (typeof described === 'string' && described !== '') found = described
			}
		}
		for (const value of Object.values(record)) walk(value)
	}
	walk(Tool.getJsonSchema(tool))
	return found
}

const FIT_FIELDS = ['fit_verdict', 'fitVerdict', 'fit_checks', 'fitChecks']

describe('who may write a company fit verdict', () => {
	describe.each([
		'create_companies',
		'update_company',
	])('the %s tool', toolName => {
		it('should accept no fit field, so a run stays the only writer', () => {
			// GIVEN the parameters the tool really publishes
			const accepted = acceptedFieldNames(toolName)

			// THEN none of the fit fields is among them. A caller that could set
			// the verdict would leave nobody able to tell what a run concluded
			// from somebody disagreeing with it
			for (const field of FIT_FIELDS)
				expect(Array.from(accepted)).not.toContain(field)
		})

		it('should accept metadata, which is where a view of your own goes', () => {
			// GIVEN the same parameters
			// THEN metadata is offered, so the rule above leaves somewhere to put
			// a judgement rather than simply refusing one
			expect(Array.from(acceptedFieldNames(toolName))).toContain('metadata')
		})

		it('should tell a caller where its own verdict goes', () => {
			// GIVEN the description a client actually receives for metadata
			const described = fieldDescription(toolName, 'metadata')

			// THEN it names the convention, because a caller that cannot find
			// fit_verdict among these parameters is otherwise left to invent a place
			// for its own judgement — which is how a second field came to exist
			expect(described).toContain('fitVerdict')
			expect(described).toContain('metadata_key')
		})
	})

	describe('the search_companies tool', () => {
		it('should still filter on the verdict a run reached', () => {
			// GIVEN the search parameters
			// AND the metadata pair added for a view of your own
			const accepted = acceptedFieldNames('search_companies')

			// THEN both routes are searchable: the run's verdict as its own filter,
			// and yours through the metadata pair
			expect(Array.from(accepted)).toContain('fit_verdict')
			expect(Array.from(accepted)).toContain('metadata_key')
			expect(Array.from(accepted)).toContain('metadata_value')
		})
	})
})
