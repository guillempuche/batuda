import { describe, expect, it } from 'vitest'

import type { ResearchAttributeDeclaration } from '@batuda/domain'

import { guardAttributes } from './attribute-guard'
import { textValueAsQuoteWrites } from './scalar-field-guard'

const TOOLS: ResearchAttributeDeclaration = {
	key: 'current_tools',
	label: 'Current tools',
	kind: 'text',
	enumValues: null,
	unit: null,
	description: null,
}
const PAGE = 'https://acme.example/about'
const entry = (raw: string, quote: string) => ({
	attributes: {
		current_tools: { value: raw, source_id: PAGE, quote, confidence: null },
	},
})
const storedValue = (findings: unknown): unknown =>
	(findings as { attributes?: { current_tools?: { value: unknown } } })
		.attributes?.current_tools?.value

describe('textValueAsQuoteWrites, over a declared text value', () => {
	it('should keep a value that runs through the quote as the quote writes it', () => {
		// GIVEN the page's words copied as they stand, markdown and case aside
		expect(
			textValueAsQuoteWrites(
				'maquinaria moderna, **Tornos CNC y Centros de mecanizado vertical CNC**',
				'Tornos CNC y centros de mecanizado vertical CNC',
			),
		).toBe('Tornos CNC y centros de mecanizado vertical CNC')
		// AND a list whose items each run through the quote
		expect(
			textValueAsQuoteWrites(
				'contamos con una Heidelberg Speedmaster XL 75 y una Komori GL 40',
				'Heidelberg Speedmaster XL 75, Komori GL 40',
			),
		).toBe('Heidelberg Speedmaster XL 75, Komori GL 40')
	})

	it('should take a remark in brackets off the end when the quote never says it', () => {
		// GIVEN the model's gloss after the value
		expect(
			textValueAsQuoteWrites(
				'a new HP Indigo VP37 press',
				'HP Indigo VP37 (digital printing press)',
			),
		).toBe('HP Indigo VP37')
		expect(
			textValueAsQuoteWrites(
				'Tornos CNC y Centros de mecanizado vertical CNC',
				'Tornos CNC y centros de mecanizado vertical CNC (según descripción de servicios)',
			),
		).toBe('Tornos CNC y centros de mecanizado vertical CNC')
		// AND a bracket the page itself writes stays
		expect(
			textValueAsQuoteWrites('Antara (ERP) desde 2024', 'Antara (ERP)'),
		).toBe('Antara (ERP)')
	})

	it('should read a comma inside a number as part of it', () => {
		// GIVEN a value with a thousands separator, copied off the page
		expect(
			textValueAsQuoteWrites('una nave de 1,500 m² en Terrassa', '1,500 m²'),
		).toBe('1,500 m²')
	})

	it('should read the words with their accents and their marks off', () => {
		// GIVEN the page writing the words with accents and the model without
		expect(textValueAsQuoteWrites('Máquina CNC nueva', 'maquina cnc')).toBe(
			'maquina cnc',
		)
	})

	it("should refuse a new phrase made of the quote's words", () => {
		// GIVEN the page's words in another order
		expect(
			textValueAsQuoteWrites('VP37 HP Indigo', 'HP Indigo VP37'),
		).toBeNull()
		// AND a machine the page never names, assembled from two it does
		expect(
			textValueAsQuoteWrites(
				'contamos con una Heidelberg Speedmaster XL 75 y una XL 106',
				'Heidelberg Speedmaster XL 106',
			),
		).toBeNull()
	})

	it('should refuse a value of words too short to look for, or with no quote to look in', () => {
		// GIVEN a value of one letter, which says nothing to look for
		expect(textValueAsQuoteWrites('abc def', 'z')).toBeNull()
		// AND a value that is only spaces
		expect(textValueAsQuoteWrites('VP37 HP Indigo', '   ')).toBeNull()
		// AND a real value with no quote behind it
		expect(textValueAsQuoteWrites('', 'HP Indigo VP37')).toBeNull()
	})

	it('should refuse a value written about the page rather than in its words', () => {
		// GIVEN the model's account of two spots on the page
		expect(
			textValueAsQuoteWrites(
				'state-of-the-art production equipment … Nueva MAZAK INTEGREX i-450H',
				'state-of-the-art production equipment, including a new MAZAK INTEGREX i-450H',
			),
		).toBeNull()
		// AND a value that is nothing but a remark
		expect(textValueAsQuoteWrites('VP37 HP Indigo', '(not stated)')).toBeNull()
	})
})

describe('guardAttributes, when a text value is not what the quote writes', () => {
	const corpus =
		'we run a new hp indigo vp37 press. state-of-the-art production equipment and over 15,000 m2. nueva mazak integrex i-450h.'

	it('should store the value with the remark off', () => {
		// GIVEN a real quote and a value with the model's gloss after it
		const result = guardAttributes(
			entry(
				'HP Indigo VP37 (digital printing press)',
				'new HP Indigo VP37 press',
			),
			corpus,
			[TOOLS],
			'company_enrichment_v1',
		)
		// THEN the page's words land, nothing dropped
		expect(storedValue(result.findings)).toBe('HP Indigo VP37')
		expect(result.kept).toBe(1)
		expect(result.drops).toEqual([])
	})

	it('should drop a value the quote does not write, naming the reason', () => {
		// GIVEN a real quote joining two spots and a value written about them
		const result = guardAttributes(
			entry(
				'state-of-the-art production equipment, including a new MAZAK INTEGREX i-450H',
				'state-of-the-art production equipment … Nueva MAZAK INTEGREX i-450H',
			),
			corpus,
			[TOOLS],
			'company_enrichment_v1',
		)
		// THEN the attribute goes as not quoted, and the map with it
		expect(storedValue(result.findings)).toBeUndefined()
		expect(result.drops).toEqual([
			{ key: 'current_tools', reason: 'value_not_quoted' },
		])
	})
})
