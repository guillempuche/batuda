import { describe, expect, it } from 'vitest'

import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { sourceHost } from '#/lib/source-host'
import {
	attributeRows,
	narrowCompanyAttributes,
	provenanceLabel,
	resolveDeclarations,
} from './attribute-rows'

const declaration = (
	over: Partial<AttributeDeclaration> & { readonly key: string },
): AttributeDeclaration => ({
	id: `attr-${over.key}`,
	stackId: 'stack-default',
	stackName: 'Default',
	label: over.key,
	kind: 'text',
	enumValues: [],
	unit: null,
	description: null,
	isActive: true,
	createdAt: '2026-09-01T10:00:00.000Z',
	...over,
})

describe('narrowCompanyAttributes [attribute-rows.ts]', () => {
	describe('when the column holds a person-set and a research-set entry', () => {
		it('should read both with who set them and the trail', () => {
			// GIVEN the stored shape of both kinds of entry
			const raw = {
				site_count: { value: 4, set_by: 'client' },
				takes_online_bookings: {
					value: false,
					source_url: 'https://calpepfonda.cat',
					quote: 'Reserves: truqueu-nos',
					as_of: '2026-06-01',
					research_id: 'run-1',
					set_by: 'research',
				},
			}
			// WHEN narrowed
			const values = narrowCompanyAttributes(raw)
			// THEN each entry keeps its value, its setter and, for research, the trail
			expect(values.get('site_count')).toEqual({
				value: 4,
				setBy: 'client',
				sourceUrl: null,
				quote: null,
				asOf: null,
				researchId: null,
			})
			expect(values.get('takes_online_bookings')).toEqual({
				value: false,
				setBy: 'research',
				sourceUrl: 'https://calpepfonda.cat',
				quote: 'Reserves: truqueu-nos',
				asOf: '2026-06-01',
				researchId: 'run-1',
			})
		})
	})

	describe('when an entry has no readable value', () => {
		it('should leave out a null, an object and a non-finite number', () => {
			// GIVEN entries a row written by hand could hold
			const raw = {
				a: { value: null, set_by: 'client' },
				b: { value: { nested: true }, set_by: 'client' },
				c: { value: Number.NaN, set_by: 'client' },
				d: 'bare text',
				e: null,
			}
			// WHEN narrowed
			// THEN none of them reads as a value
			expect(narrowCompanyAttributes(raw).size).toBe(0)
		})

		it('should keep zero, false and an empty string as values', () => {
			// GIVEN the falsy values a person may set on purpose
			const raw = {
				zero: { value: 0, set_by: 'client' },
				no: { value: false, set_by: 'client' },
				blank: { value: '', set_by: 'client' },
			}
			// WHEN narrowed
			// THEN all three survive
			expect([...narrowCompanyAttributes(raw).keys()]).toEqual([
				'zero',
				'no',
				'blank',
			])
		})
	})

	describe('when an entry does not say who set it', () => {
		it('should read it as a person value', () => {
			// GIVEN an entry without set_by
			// WHEN narrowed
			// THEN it is a person's, which is the setter that may edit it
			expect(
				narrowCompanyAttributes({ k: { value: 'x' } }).get('k')?.setBy,
			).toBe('client')
		})
	})

	describe('when the column is not an object', () => {
		it('should answer an empty map for null, a list and text', () => {
			// GIVEN shapes the column never holds
			// WHEN narrowed
			// THEN nothing throws and nothing is read
			expect(narrowCompanyAttributes(null).size).toBe(0)
			expect(narrowCompanyAttributes([1]).size).toBe(0)
			expect(narrowCompanyAttributes('{}').size).toBe(0)
		})
	})
})

describe('resolveDeclarations [attribute-rows.ts]', () => {
	describe('when two stacks declare the same key', () => {
		it('should keep one per key, the first by stack name then creation', () => {
			// GIVEN the same key on two stacks and one retired declaration
			const declarations = [
				declaration({
					key: 'current_tools',
					stackName: 'Hospitality',
					id: 'later',
				}),
				declaration({
					key: 'current_tools',
					stackName: 'Default',
					id: 'first',
				}),
				declaration({ key: 'uses_whatsapp', isActive: false }),
				declaration({ key: 'site_count' }),
			]
			// WHEN resolved
			const out = resolveDeclarations(declarations)
			// THEN the retired one is gone, the key appears once, from the Default stack
			expect(out.map(d => [d.key, d.id])).toEqual([
				['current_tools', 'first'],
				['site_count', 'attr-site_count'],
			])
		})
	})

	describe('when creation dates differ on one stack', () => {
		it('should order by creation within the stack', () => {
			// GIVEN two declarations on one stack created in reverse order
			const declarations = [
				declaration({ key: 'b', createdAt: '2026-09-02T00:00:00.000Z' }),
				declaration({ key: 'a', createdAt: '2026-09-01T00:00:00.000Z' }),
			]
			// WHEN resolved
			// THEN the earlier one comes first
			expect(resolveDeclarations(declarations).map(d => d.key)).toEqual([
				'a',
				'b',
			])
		})
	})
})

describe('attributeRows [attribute-rows.ts]', () => {
	it('should pair each declared key with its value and set the rest aside', () => {
		// GIVEN two declarations, one filled, and a value under a key nobody declares
		const declarations = [
			declaration({ key: 'site_count', kind: 'number' }),
			declaration({ key: 'fit', kind: 'enum', enumValues: ['strong'] }),
		]
		const values = narrowCompanyAttributes({
			site_count: { value: 4, set_by: 'client' },
			old_key: { value: 'kept', set_by: 'client' },
		})
		// WHEN the rows are built
		const rows = attributeRows(declarations, values)
		// THEN the declared rows carry the value or null, and the stray key is other
		expect(
			rows.declared.map(r => [r.declaration.key, r.stored?.value]),
		).toEqual([
			['site_count', 4],
			['fit', undefined],
		])
		expect(rows.other).toEqual([
			{
				key: 'old_key',
				stored: {
					value: 'kept',
					setBy: 'client',
					sourceUrl: null,
					quote: null,
					asOf: null,
					researchId: null,
				},
				// Nothing in the list declares this key, so there are no words for it
				declaration: null,
			},
		])
	})

	it('should file a value under a retired key as other, with its declaration', () => {
		// GIVEN a retired declaration whose key still holds a value
		const retired = declaration({
			key: 'uses_whatsapp',
			label: 'Uses WhatsApp',
			kind: 'boolean',
			isActive: false,
		})
		const values = narrowCompanyAttributes({
			uses_whatsapp: { value: true, set_by: 'client' },
		})
		// WHEN the rows are built
		const rows = attributeRows([retired], values)
		// THEN there is no declared row, and the value sits with the others keeping
		// the words and the kind it was written under
		expect(rows.declared).toEqual([])
		expect(rows.other.map(o => [o.key, o.declaration])).toEqual([
			['uses_whatsapp', retired],
		])
	})

	it('should leave a value alone when its key is declared and active elsewhere', () => {
		// GIVEN one key retired on a stack and still active on another
		const retired = declaration({
			key: 'fit',
			stackName: 'Hospitality',
			isActive: false,
		})
		const active = declaration({ key: 'fit', stackName: 'Default' })
		const values = narrowCompanyAttributes({
			fit: { value: 'strong', set_by: 'client' },
		})
		// WHEN the rows are built
		const rows = attributeRows([retired, active], values)
		// THEN the row is editable under the active declaration, not filed as other
		expect(rows.declared.map(r => r.declaration.stackName)).toEqual(['Default'])
		expect(rows.other).toEqual([])
	})

	it('should answer two empty lists when nothing is declared or stored', () => {
		// GIVEN no declarations and no values
		// WHEN the rows are built
		// THEN both lists are empty
		expect(attributeRows([], new Map())).toEqual({ declared: [], other: [] })
	})
})

describe('sourceHost [source-host.ts]', () => {
	it('should show the host without www, and the text itself when not an address', () => {
		// GIVEN a page address with www and a plain word
		// WHEN the host is read
		// THEN the address gives its bare host and the word comes back unchanged
		expect(sourceHost('https://www.calpepfonda.cat/reserves')).toBe(
			'calpepfonda.cat',
		)
		expect(sourceHost('not a url')).toBe('not a url')
	})
})

describe('provenanceLabel [attribute-rows.ts]', () => {
	it('should name a declared attribute by its label and an undeclared one by its key', () => {
		// GIVEN a declaration for site_count only
		const declarations = [declaration({ key: 'site_count', label: 'Sites' })]
		// WHEN the provenance keys are labelled
		// THEN the declared key shows its label, the other its bare key, a plain field stays
		expect(provenanceLabel('attributes.site_count', declarations)).toBe('Sites')
		expect(provenanceLabel('attributes.old_key', declarations)).toBe('old_key')
		expect(provenanceLabel('industry', declarations)).toBe('industry')
	})
})
