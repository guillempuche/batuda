import { Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CutOffReply } from '../domain/errors'
import { keepWhatArrived, salvageCutOffReply } from './cut-off-salvage'

// Shaped like a market scan's answer: a row needs its name, its reason and its
// citations, and the citations come last — so the row a cut falls in can never
// be kept, and one earlier row written wrong fails every whole reading.
const Citation = Schema.Struct({
	source_id: Schema.String,
	confidence: Schema.Number,
	quote: Schema.optionalKey(Schema.String),
})
const ScanShape = Schema.Struct({
	summary: Schema.optionalKey(Schema.String),
	prospects: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			why_relevant: Schema.String,
			website: Schema.optionalKey(Schema.String),
			citations: Schema.Array(Citation),
		}),
	),
})

const ContactsShape = Schema.Struct({
	contacts: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			citations: Schema.Array(Citation),
		}),
	),
})

const cutOff = (text: string) =>
	new CutOffReply({ provider: 'stub', message: 'reply cut off' }, text)

const row = (name: string, extra = '') =>
	`{"name": "${name}", "why_relevant": "installs"${extra}, "citations": [{"source_id": "https://${name}.example", "confidence": 1}]}`

describe('salvageCutOffReply, read row by row', () => {
	describe('when one earlier row does not fit the shape', () => {
		it('should keep the rows that fit and say how many it left out', async () => {
			// GIVEN a scan reply whose second row has a citation with no
			// confidence, cut inside the fourth row
			const misfit =
				'{"name": "beta", "why_relevant": "installs", "citations": [{"source_id": "https://beta.example"}]}'
			const text = `{"summary": "three found", "prospects": [${row('alfa')}, ${misfit}, ${row('gamma')}, {"name": "delta", "why_rel`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN the two rows that fit are kept with the summary written before
			// them, and both the misfit and the row the cut fell in are counted as
			// left out
			expect(
				salvaged?.value.prospects.map((kept: { name: string }) => kept.name),
			).toEqual(['alfa', 'gamma'])
			expect(salvaged?.value.summary).toBe('three found')
			expect(salvaged?.rows).toEqual({ kept: 2, leftOut: 2 })
		})

		it('should keep nothing when the list is not named', async () => {
			// GIVEN the same kind of reply
			const misfit = '{"name": "beta", "why_relevant": "installs"}'
			const text = `{"prospects": [${misfit}, ${row('gamma')}, {"name": "delta", "why_rel`

			// WHEN salvaged the way a later pass asks, without the list
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape),
			)

			// THEN nothing is kept
			expect(salvaged).toBeUndefined()
		})
	})

	describe('when the model wrote null for what it had nothing for', () => {
		it('should read the rows as a whole reply is read, null standing for a field left out', async () => {
			// GIVEN a reply written the way a model writes one: every field a row
			// may go without is there and null, and the cut falls in the third row
			const written = (name: string) =>
				`{"name": "${name}", "why_relevant": "installs", "website": null, "citations": [{"source_id": "https://${name}.example", "confidence": 1, "quote": null}]}`
			const text = `{"summary": null, "prospects": [${written('alfa')}, ${written('beta')}, {"name": "gamma", "why_relevant": "inst`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN both whole rows are kept, their nulls read as fields left out
			expect(salvaged?.value.prospects).toEqual([
				{
					name: 'alfa',
					why_relevant: 'installs',
					citations: [{ source_id: 'https://alfa.example', confidence: 1 }],
				},
				{
					name: 'beta',
					why_relevant: 'installs',
					citations: [{ source_id: 'https://beta.example', confidence: 1 }],
				},
			])
		})
	})

	describe('when a key beside the list is written wrong', () => {
		it('should lose that key alone and keep the others', async () => {
			// GIVEN a shape with two keys beside its list, a reply whose `found`
			// is a number where a text belongs, and one row that does not fit
			const Shape = Schema.Struct({
				summary: Schema.optionalKey(Schema.String),
				found: Schema.optionalKey(Schema.String),
				prospects: ScanShape.fields.prospects,
			})
			const text = `{"summary": "two found", "found": 7, "prospects": [{"name": "beta"}, ${row('alfa')}, {"name": "ga`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), Shape, 'prospects'),
			)

			// THEN the row that fits and the key that fits are kept
			expect(salvaged?.value).toEqual({
				summary: 'two found',
				prospects: [expect.objectContaining({ name: 'alfa' })],
			})
		})
	})

	describe('when the reply decodes whole at some depth', () => {
		it('should take the whole reading and not count rows', async () => {
			// GIVEN a reply of fitting rows cut inside the third
			const text = `{"prospects": [${row('alfa')}, ${row('gamma')}, {"name": "delta", "why_rel`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN both whole rows are kept by the whole reading
			expect(salvaged?.value.prospects).toHaveLength(2)
			expect(salvaged?.rows).toBeUndefined()
		})
	})

	describe('when the cut falls inside a citation of a later row', () => {
		it('should keep that row too when the citation stands without the words the cut took', async () => {
			// GIVEN a reply cut inside the second row's quote, which a citation
			// may go without
			const text = `{"prospects": [${row('alfa')}, {"name": "beta", "why_relevant": "installs", "citations": [{"source_id": "https://beta.example", "confidence": 1, "quote": "instal·lacions el`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN both rows survive, the second cited without its quote
			expect(salvaged?.value.prospects).toEqual([
				expect.objectContaining({ name: 'alfa' }),
				{
					name: 'beta',
					why_relevant: 'installs',
					citations: [{ source_id: 'https://beta.example', confidence: 1 }],
				},
			])
		})

		it('should keep only the rows before it when the cut took what the citation needs', async () => {
			// GIVEN a reply cut inside the second row's citation before its
			// confidence was written
			const text = `{"prospects": [${row('alfa')}, {"name": "beta", "why_relevant": "installs", "citations": [{"source_id": "https://beta.exa`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN the first row survives alone
			expect(
				salvaged?.value.prospects.map((kept: { name: string }) => kept.name),
			).toEqual(['alfa'])
		})
	})

	describe('when the cut falls inside the first row', () => {
		it('should keep nothing, for no row arrived whole', async () => {
			// GIVEN a reply cut before its first row closed
			const text =
				'{"prospects": [{"name": "alfa", "why_relevant": "installs", "citations": [{"source_id": "https://alfa.exa'

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN nothing is kept
			expect(salvaged).toBeUndefined()
		})
	})

	describe('when no row fits the shape', () => {
		it('should keep nothing rather than an empty list', async () => {
			// GIVEN a reply whose every whole row lacks its citations
			const bare = (name: string) =>
				`{"name": "${name}", "why_relevant": "installs"}`
			const text = `{"prospects": [${bare('alfa')}, ${bare('beta')}, {"name": "ga`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN nothing is kept — an empty list would read as a market with
			// nobody in it
			expect(salvaged).toBeUndefined()
		})
	})

	describe('when the list is a run of people', () => {
		it('should read a contacts reply the same way', async () => {
			// GIVEN a contacts reply with a person missing their citations, cut
			// inside the third
			const person = (name: string) =>
				`{"name": "${name}", "citations": [{"source_id": "https://acme.example/team", "confidence": 1}]}`
			const text = `{"contacts": [{"name": "Ana Puig"}, ${person('Jordi Vila')}, {"name": "Marta So`

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ContactsShape, 'contacts'),
			)

			// THEN the person who fits is kept
			expect(
				salvaged?.value.contacts.map((kept: { name: string }) => kept.name),
			).toEqual(['Jordi Vila'])
			expect(salvaged?.rows).toEqual({ kept: 1, leftOut: 1 })
		})
	})

	describe('when the named list is not in the reply', () => {
		it('should keep nothing', async () => {
			// GIVEN a reply cut before the list was ever written
			const text = '{"summary": "a long summary that never en'

			// WHEN salvaged with the list named
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), ScanShape, 'prospects'),
			)

			// THEN nothing is kept
			expect(salvaged).toBeUndefined()
		})
	})
})

describe('keepWhatArrived, with both cut-off replies in hand', () => {
	describe('when the first reply got further than the second', () => {
		it('should ship the first', async () => {
			// GIVEN a first reply with two whole rows and a shorter second one
			// with a single whole row
			const first = cutOff(
				`{"prospects": [${row('alfa')}, ${row('beta')}, {"name": "ga`,
			)
			const second = cutOff(`{"prospects": [${row('alfa')}, {"name": "be`)

			// WHEN kept
			const reply = await Effect.runPromise(
				keepWhatArrived(second, ScanShape, 'run-1', {
					listField: 'prospects',
					earlierCutOff: first,
				}),
			)

			// THEN the longer list ships
			expect(reply.value.prospects).toHaveLength(2)
		})
	})

	describe('when the second reply got further', () => {
		it('should ship the second', async () => {
			// GIVEN a first reply with one whole row and a second with two
			const first = cutOff(`{"prospects": [${row('alfa')}, {"name": "be`)
			const second = cutOff(
				`{"prospects": [${row('alfa')}, ${row('beta')}, {"name": "ga`,
			)

			// WHEN kept
			const reply = await Effect.runPromise(
				keepWhatArrived(second, ScanShape, 'run-1', {
					listField: 'prospects',
					earlierCutOff: first,
				}),
			)

			// THEN the second ships
			expect(reply.value.prospects).toHaveLength(2)
		})
	})

	describe('when only the first reply holds anything whole', () => {
		it('should ship the first rather than lose the run', async () => {
			// GIVEN a second reply cut inside its first row
			const first = cutOff(`{"prospects": [${row('alfa')}, {"name": "be`)
			const second = cutOff('{"prospects": [{"name": "al')

			// WHEN kept
			const reply = await Effect.runPromise(
				keepWhatArrived(second, ScanShape, 'run-1', {
					listField: 'prospects',
					earlierCutOff: first,
				}),
			)

			// THEN the first reply's row ships
			expect(reply.value.prospects).toHaveLength(1)
		})
	})

	describe('when neither reply holds anything whole', () => {
		it('should fail with the latest cut-off', async () => {
			// GIVEN two replies cut inside their first rows
			const first = cutOff('{"prospects": [{"name": "alfa", "why_rel')
			const second = cutOff('{"prospects": [{"name": "al')

			// WHEN kept
			const exit = await Effect.runPromiseExit(
				keepWhatArrived(second, ScanShape, 'run-1', {
					listField: 'prospects',
					earlierCutOff: first,
				}),
			)

			// THEN the latest failure comes back
			expect(Exit.isFailure(exit)).toBe(true)
			expect(
				Exit.isFailure(exit) &&
					exit.cause.reasons.some(
						reason => 'error' in reason && reason.error === second,
					),
			).toBe(true)
		})
	})

	describe('when the reply is not a list', () => {
		it('should read the latest reply alone, however much more the first kept', async () => {
			// GIVEN a wordy first reply and a shorter second one, with no list named
			const first = cutOff(
				`{"summary": "${'long '.repeat(50)}", "prospects": [${row('alfa')}, {"name": "be`,
			)
			const second = cutOff(
				`{"prospects": [${row('alfa')}, ${row('beta')}, {"name": "ga`,
			)

			// WHEN kept without a list to measure by
			const reply = await Effect.runPromise(
				keepWhatArrived(second, ScanShape, 'run-1', { earlierCutOff: first }),
			)

			// THEN the latest reply ships, the wordier first one left aside
			expect(reply.value.prospects).toHaveLength(2)
			expect(reply.value.summary).toBeUndefined()
		})
	})

	describe('when the earlier failure is not a cut-off reply', () => {
		it('should read the latest alone', async () => {
			// GIVEN an earlier failure with no text behind it
			const second = cutOff(`{"prospects": [${row('alfa')}, {"name": "be`)

			// WHEN kept
			const reply = await Effect.runPromise(
				keepWhatArrived(second, ScanShape, 'run-1', {
					listField: 'prospects',
					earlierCutOff: new Error('timeout'),
				}),
			)

			// THEN the latest reply's row ships
			expect(reply.value.prospects).toHaveLength(1)
		})
	})
})
