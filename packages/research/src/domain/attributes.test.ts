import { describe, expect, it } from 'vitest'

import { parseAttributeDeclarations } from './attributes'

const declaration = (key: string) => ({
	key,
	label: key,
	kind: 'text',
	enumValues: null,
	unit: null,
	description: null,
})

describe('parseAttributeDeclarations', () => {
	describe('when the run row carries well-formed declarations', () => {
		it('should read them back as they were written', () => {
			// GIVEN two declarations as the column stores them
			const raw = [declaration('a'), { ...declaration('b'), kind: 'number' }]

			// THEN both come back, typed
			expect(parseAttributeDeclarations(raw)).toEqual(raw)
		})
	})

	describe('when an entry cannot be read', () => {
		it('should leave that entry out and keep the rest', () => {
			// GIVEN a kind this build does not know, a missing label, and a non-object
			const raw = [
				declaration('a'),
				{ ...declaration('b'), kind: 'colour' },
				{ key: 'c' },
				'd',
				declaration('e'),
			]

			// THEN only the readable ones survive, in order
			expect(parseAttributeDeclarations(raw).map(d => d.key)).toEqual([
				'a',
				'e',
			])
		})
	})

	describe('when the column holds something other than a list', () => {
		it('should read no declarations at all', () => {
			for (const raw of [null, undefined, 'x', 7, { key: 'a' }])
				expect(parseAttributeDeclarations(raw)).toEqual([])
		})
	})

	describe('when more are stored than a stack may declare', () => {
		it('should keep the first eight', () => {
			// GIVEN twelve declarations
			const raw = Array.from({ length: 12 }, (_, i) => declaration(`k${i}`))

			// THEN the cap holds
			expect(parseAttributeDeclarations(raw)).toHaveLength(8)
		})
	})
})
