import { describe, expect, it } from 'vitest'

import type { AttributeDeclaration } from '#/components/instructions/attribute-shapes'
import { declaredAttributes, narrowFoundAttributes } from './found-attributes'

// One declaration as the settings page narrows it.
const declaration = (
	over: Partial<AttributeDeclaration>,
): AttributeDeclaration => ({
	id: 'a1',
	stackId: 's1',
	stackName: 'Girona',
	key: 'site_count',
	label: 'Sites',
	kind: 'number',
	enumValues: [],
	unit: null,
	description: null,
	isActive: true,
	createdAt: null,
	...over,
})

// One row as a run wrote it.
const row = (key: string, value: string | number | boolean) => ({
	key,
	value,
	sourceId: null,
	quote: null,
})

// The map as a company profile carries it: the values under their own keys, the
// pages they were read on beside them under the same keys.
const found = {
	site_count: 3,
	takes_bookings: true,
	opened_on: '2019-04-01',
	booking_tool: 'Paper reservations book',
	evidence: {
		site_count: {
			source_id: 'https://calpepfonda.cat/locals',
			quote: 'Tres locals a Girona',
			confidence: null,
		},
		booking_tool: { source_id: 'https://calpepfonda.cat/reserves' },
	},
}

describe('narrowFoundAttributes [found-attributes.ts]', () => {
	describe('when a run filled several attributes', () => {
		it('should pair each value with the page it was read on', () => {
			// GIVEN the map a finished run hands a reader
			// WHEN read back
			const rows = narrowFoundAttributes(found)

			// THEN every kind of value survives, in the order the run wrote them,
			// each carrying its own page and quote
			expect(rows).toEqual([
				{
					key: 'site_count',
					value: 3,
					sourceId: 'https://calpepfonda.cat/locals',
					quote: 'Tres locals a Girona',
				},
				{
					key: 'takes_bookings',
					value: true,
					sourceId: null,
					quote: null,
				},
				{
					key: 'opened_on',
					value: '2019-04-01',
					sourceId: null,
					quote: null,
				},
				{
					key: 'booking_tool',
					value: 'Paper reservations book',
					sourceId: 'https://calpepfonda.cat/reserves',
					quote: null,
				},
			])
		})
	})

	describe('when the map holds nothing but the evidence', () => {
		it('should read as no attributes at all', () => {
			// GIVEN a map whose only key is the reserved one
			// WHEN read back
			// THEN there is nothing to show, so the block can stay away
			expect(
				narrowFoundAttributes({ evidence: { site_count: { source_id: 'x' } } }),
			).toEqual([])
		})
	})

	describe('when there is no map', () => {
		it('should read as no attributes', () => {
			// GIVEN what a run that filled none hands over, and the shapes a stored
			// run can hold in its place
			// THEN each reads as nothing rather than throwing on the way in
			expect(narrowFoundAttributes(undefined)).toEqual([])
			expect(narrowFoundAttributes(null)).toEqual([])
			expect(narrowFoundAttributes('site_count')).toEqual([])
			expect(narrowFoundAttributes([{ key: 'site_count', value: 3 }])).toEqual(
				[],
			)
		})
	})

	describe('when the evidence is not a map of pages', () => {
		it('should still show the values, with no page named', () => {
			// GIVEN a run whose evidence came back as something else entirely
			const rows = narrowFoundAttributes({
				site_count: 3,
				evidence: 'https://calpepfonda.cat/locals',
			})

			// WHEN read back — THEN the value survives without a citation, rather
			// than the whole block going missing over the half beside it
			expect(rows).toEqual([
				{ key: 'site_count', value: 3, sourceId: null, quote: null },
			])
		})
	})

	describe('when an entry holds nothing a person could read', () => {
		it('should leave that one out and keep the rest', () => {
			// GIVEN a map carrying a cleared key, a nested object and a figure no
			// number line holds
			const rows = narrowFoundAttributes({
				site_count: 3,
				cleared: null,
				nested: { locals: 3 },
				unreadable: Number.NaN,
			})

			// WHEN read back — THEN only the value that can be shown is
			expect(rows.map(row => row.key)).toEqual(['site_count'])
		})
	})

	describe('when a value still sits with its own page', () => {
		it('should read the value out and keep the page', () => {
			// GIVEN a map nothing split in two, which is what a run carrying an
			// attribute called `evidence` hands over
			const rows = narrowFoundAttributes({
				site_count: {
					value: 3,
					source_id: 'https://calpepfonda.cat/locals',
					quote: 'Tres locals',
					confidence: null,
				},
				evidence: { value: true },
			})

			// WHEN read back — THEN the rest of the map reads as values rather than
			// as objects a screen would try to print
			expect(rows).toEqual([
				{
					key: 'site_count',
					value: 3,
					sourceId: 'https://calpepfonda.cat/locals',
					quote: 'Tres locals',
				},
			])
		})
	})
})

describe('declaredAttributes [found-attributes.ts]', () => {
	describe('when a key nobody declares any more turns up', () => {
		it('should drop it, since nothing would be recorded under it', () => {
			// GIVEN a retired declaration beside a live one
			const kept = declaredAttributes(
				[row('site_count', 3), row('takes_bookings', true)],
				[
					declaration({}),
					declaration({
						id: 'a2',
						key: 'takes_bookings',
						kind: 'boolean',
						isActive: false,
					}),
				],
			)

			// THEN only the live key survives
			expect(kept).toEqual([row('site_count', 3)])
		})
	})

	describe('when a value no longer reads as the kind it was declared with', () => {
		it('should drop it rather than promise a write that will not happen', () => {
			// GIVEN words under a key declared as a number
			const kept = declaredAttributes(
				[row('site_count', 'a few')],
				[declaration({})],
			)

			// THEN nothing is kept
			expect(kept).toEqual([])
		})
	})

	describe('when a value reads as its kind in another spelling', () => {
		it('should keep it as the kind reads it, which is what lands', () => {
			// GIVEN a number written as text, and a choice in the wrong case
			const kept = declaredAttributes(
				[row('site_count', ' 3 '), row('fleet', 'OWN FLEET')],
				[
					declaration({}),
					declaration({
						id: 'a2',
						key: 'fleet',
						kind: 'enum',
						enumValues: ['own fleet', 'hired'],
					}),
				],
			)

			// THEN each is kept in the form the company will hold it in, so the
			// screen showing it shows what was actually recorded
			expect(kept).toEqual([row('site_count', 3), row('fleet', 'own fleet')])
		})
	})

	describe('when the page does not know what is declared yet', () => {
		it('should keep every row and leave the decision to the server', () => {
			// GIVEN declarations that have not arrived
			const rows = [row('site_count', 'a few'), row('anything', 2)]

			// THEN nothing is held back: guessing here would drop a value that is
			// perfectly declared, on a page that simply has not been told
			expect(declaredAttributes(rows, null)).toEqual(rows)
		})
	})

	describe('when the evidence travels with the value', () => {
		it('should carry the page and the words across', () => {
			// GIVEN a grounded row under a declared key
			const grounded = {
				key: 'site_count',
				value: 3,
				sourceId: 'https://calpepfonda.cat/locals',
				quote: 'Tres locals',
			}

			// THEN what was read off the page stays with it
			expect(declaredAttributes([grounded], [declaration({})])).toEqual([
				grounded,
			])
		})
	})
})
