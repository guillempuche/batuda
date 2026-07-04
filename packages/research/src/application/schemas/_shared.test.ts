import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { TolerantJsonString } from './_shared'
import { FreeformSchema } from './freeform'
import { ProspectScanV1Schema } from './prospect-scan-v1'

describe('TolerantJsonString', () => {
	const decode = Schema.decodeUnknownSync(TolerantJsonString)

	describe('when the string is valid JSON', () => {
		it('should decode it to the parsed value', () => {
			// GIVEN a JSON-encoded object — the shape the model is asked to produce
			// WHEN it is decoded
			const decoded = decode('{"q":"contact","limit":3}')
			// THEN it becomes the parsed object
			expect(decoded).toEqual({ q: 'contact', limit: 3 })
		})
	})

	describe('when the model returns prose instead of JSON', () => {
		it('should keep the raw string instead of throwing', () => {
			// GIVEN the exact failure from production: the model wrote a
			// natural-language instruction where a JSON object was expected
			const prose = 'look up Maria at the town hall'
			// WHEN it is decoded
			// THEN it does not throw and the raw text is preserved verbatim
			expect(() => decode(prose)).not.toThrow()
			expect(decode(prose)).toBe(prose)
		})
	})
})

describe('ProspectScanV1Schema (shared PendingPaidAction.args)', () => {
	const decode = Schema.decodeUnknownSync(ProspectScanV1Schema)
	const withArgs = (args: string) => ({
		prospects: [
			{ name: 'Acme', why_relevant: 'fit', citations: [{ source_id: 's1' }] },
		],
		pending_paid_actions: [
			{ tool: 'lookup_registry', args, estimated_cents: 10, reason: 'need id' },
		],
	})

	describe('when a pending paid action carries prose in args', () => {
		it('should decode the whole payload instead of failing the extraction', () => {
			// GIVEN a structured result whose paid action has prose args — the
			// case that failed research run 0b9399d7 in production
			// WHEN the full schema is decoded
			const decoded = decode(withArgs('look up Maria'))
			// THEN it succeeds and the prose survives as the raw args
			expect(decoded.pending_paid_actions?.[0]?.args).toBe('look up Maria')
		})
	})

	describe('when a pending paid action carries a JSON-encoded args object', () => {
		it('should decode args to the parsed object', () => {
			// GIVEN the well-formed case the model is meant to produce
			// WHEN the full schema is decoded
			// THEN args is the parsed object
			expect(
				decode(withArgs('{"tax_id":"B123"}')).pending_paid_actions?.[0]?.args,
			).toEqual({ tax_id: 'B123' })
		})
	})
})

describe('FreeformSchema (inlined proposed_updates.fields)', () => {
	const decode = Schema.decodeUnknownSync(FreeformSchema)

	describe('when proposed_updates.fields is prose rather than JSON', () => {
		it('should decode instead of failing, keeping the raw text', () => {
			// GIVEN freeform's own inlined open-ended field map filled with prose
			const payload = {
				proposed_updates: [
					{
						subject_table: 'companies',
						subject_id: 'c1',
						expected_version: 1,
						fields: 'set the industry to logistics',
						reason: 'observed on the site',
						citations: [{ source_id: 's1' }],
					},
				],
			}
			// WHEN it is decoded
			// THEN it does not throw and the raw text is preserved
			expect(() => decode(payload)).not.toThrow()
			expect(decode(payload).proposed_updates?.[0]?.fields).toBe(
				'set the industry to logistics',
			)
		})
	})
})
