import { Schema } from 'effect'
import { OpenAiStructuredOutput } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { LenientNumber, Sourced, TolerantJsonString } from './_shared'
import { CompetitorScanV1Schema } from './competitor-scan-v1'
import { ContactDiscoveryV1Schema } from './contact-discovery-v1'
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

describe('LenientNumber', () => {
	const decode = Schema.decodeUnknownSync(LenientNumber)

	describe('when the value is a finite number', () => {
		it('should keep it unchanged', () => {
			// GIVEN a real number the model produced
			// THEN it passes through untouched
			expect(decode(5)).toBe(5)
			expect(decode(0)).toBe(0)
			expect(decode(-90.5)).toBe(-90.5)
		})
	})

	describe('when the value is a numeric string', () => {
		it('should parse it to the number', () => {
			// GIVEN a number the model quoted as a string
			// THEN it decodes to the underlying number
			expect(decode('5')).toBe(5)
			expect(decode('0.85')).toBe(0.85)
		})
	})

	describe('when the model emits a value it could not work out', () => {
		it('should coerce every non-finite value to null instead of failing', () => {
			// GIVEN the strings and numbers a model returns for "no value" — the
			// literal "NaN" is the exact shape that failed enrichment runs
			// THEN each becomes null rather than throwing a decode error
			expect(decode('NaN')).toBeNull()
			expect(decode('Infinity')).toBeNull()
			expect(decode('-Infinity')).toBeNull()
			expect(decode(Number.NaN)).toBeNull()
			expect(decode(Number.POSITIVE_INFINITY)).toBeNull()
			expect(decode('')).toBeNull()
			expect(decode('not a number')).toBeNull()
		})
	})

	describe('when converted through the OpenAI structured-output codec', () => {
		it('should still coerce a "NaN" numeric field to null in the real decode path', () => {
			// GIVEN production's actual decode path: the model's JSON is decoded
			// through the codec toCodecOpenAI produces, not the raw schema — the
			// union-input transform has to survive that conversion
			const { codec } = OpenAiStructuredOutput.toCodecOpenAI(
				CompetitorScanV1Schema,
			)
			const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(codec))
			const json = JSON.stringify({
				competitors: [],
				market_summary: { total_competitors_found: 'NaN', citations: [] },
			})

			// WHEN the model emits the string "NaN" for the count
			// THEN the codec conversion does not throw and the field decodes to null
			const decoded = decodeJson(json)
			expect(decoded.market_summary?.total_competitors_found).toBeNull()
		})
	})
})

describe('numeric guards on model-produced fields', () => {
	describe('when a competitor scan reports "NaN" competitors found', () => {
		it('should coerce the count and the shared citation confidence to null', () => {
			// GIVEN a market summary whose count and citation confidence are "NaN"
			const decoded = Schema.decodeUnknownSync(CompetitorScanV1Schema)({
				competitors: [],
				market_summary: {
					total_competitors_found: 'NaN',
					citations: [{ source_id: 's1', confidence: 'NaN' }],
				},
			})
			// THEN both the inline count and the shared Citation.confidence are null
			expect(decoded.market_summary?.total_competitors_found).toBeNull()
			expect(decoded.market_summary?.citations[0]?.confidence).toBeNull()
		})
	})

	describe('when a discovered contact channel has "NaN" confidence', () => {
		it('should coerce the channel confidence to null', () => {
			// GIVEN a contact channel the model annotated with a "NaN" confidence
			const decoded = Schema.decodeUnknownSync(ContactDiscoveryV1Schema)({
				contacts: [
					{
						name: 'Maria',
						channels: [{ kind: 'email', value: 'm@x.cat', confidence: 'NaN' }],
						citations: [{ source_id: 's1' }],
					},
				],
			})
			// THEN the inlined confidence decodes to null
			expect(decoded.contacts[0]?.channels?.[0]?.confidence).toBeNull()
		})
	})

	describe('when shared proposed-update and paid-action numbers are "NaN"', () => {
		it('should coerce expected_version and estimated_cents to null', () => {
			// GIVEN the shared ProposedUpdate / PendingPaidAction fragments (used
			// by every registry schema) filled with "NaN" numbers
			const decoded = Schema.decodeUnknownSync(ProspectScanV1Schema)({
				prospects: [
					{
						name: 'Acme',
						why_relevant: 'fit',
						citations: [{ source_id: 's1' }],
					},
				],
				proposed_updates: [
					{
						subject_table: 'companies',
						subject_id: 'c1',
						expected_version: 'NaN',
						fields: '{"industry":"logistics"}',
						reason: 'r',
						citations: [{ source_id: 's1' }],
					},
				],
				pending_paid_actions: [
					{
						tool: 'lookup_registry',
						args: '{}',
						estimated_cents: 'NaN',
						reason: 'r',
					},
				],
			})
			// THEN both numbers decode to null
			expect(decoded.proposed_updates?.[0]?.expected_version).toBeNull()
			expect(decoded.pending_paid_actions?.[0]?.estimated_cents).toBeNull()
		})
	})

	describe('when freeform inlines "NaN" proposed-update numbers', () => {
		it('should coerce its own copies of expected_version and estimated_cents to null', () => {
			// GIVEN freeform's inlined (non-shared) numeric fields set to "NaN"
			const decoded = Schema.decodeUnknownSync(FreeformSchema)({
				proposed_updates: [
					{
						subject_table: 'companies',
						subject_id: 'c1',
						expected_version: 'NaN',
						fields: '{"industry":"logistics"}',
						reason: 'r',
						citations: [{ source_id: 's1' }],
					},
				],
				pending_paid_actions: [
					{
						tool: 'lookup_registry',
						args: '{}',
						estimated_cents: 'NaN',
						reason: 'r',
					},
				],
			})
			// THEN the inlined copies decode to null too
			expect(decoded.proposed_updates?.[0]?.expected_version).toBeNull()
			expect(decoded.pending_paid_actions?.[0]?.estimated_cents).toBeNull()
		})
	})
})

describe('Sourced', () => {
	const decode = Schema.decodeUnknownSync(Sourced(Schema.String))

	describe('when a field carries its value and a source', () => {
		it('should decode to the value plus its citation fields', () => {
			// GIVEN a per-field wrapper the model filled with a value and its source
			const decoded = decode({
				value: 'manufacturing',
				source_id: 'https://acme.es',
				quote: 'We manufacture bicycles',
				confidence: 0.9,
			})
			// THEN the value and the source ride together in one object
			expect(decoded.value).toBe('manufacturing')
			expect(decoded.source_id).toBe('https://acme.es')
			expect(decoded.quote).toBe('We manufacture bicycles')
			expect(decoded.confidence).toBe(0.9)
		})
	})

	describe('when only the value and source are present', () => {
		it('should decode with quote and confidence absent', () => {
			// GIVEN the minimal wrapper — the source is required, the rest optional
			const decoded = decode({ value: 'retail', source_id: 's1' })
			// THEN it decodes, carrying no quote
			expect(decoded.value).toBe('retail')
			expect(decoded).not.toHaveProperty('quote')
		})
	})

	describe('when the confidence is the string "NaN" the model could not work out', () => {
		it('should coerce it to null, reusing the shared lenient-number rule', () => {
			// GIVEN a wrapper whose confidence came back as the literal "NaN"
			const decoded = decode({
				value: 'serveis',
				source_id: 's1',
				confidence: 'NaN',
			})
			// THEN it becomes null rather than failing the whole decode
			expect(decoded.confidence).toBeNull()
		})
	})

	describe('when the value is missing', () => {
		it('should reject the wrapper — a source with no value is meaningless', () => {
			// GIVEN a wrapper that cites a source but carries no value
			// THEN decoding fails (value is required inside the wrapper)
			expect(() => decode({ source_id: 's1' })).toThrow()
		})
	})
})
