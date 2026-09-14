import { describe, expect, it } from 'vitest'

import { closeCutOffJson, endsBeforeJsonCloses } from './cut-off-reply'

describe('endsBeforeJsonCloses', () => {
	describe('when a reply stops before its JSON closes', () => {
		it('should say so, wherever the cut landed', () => {
			// GIVEN replies cut inside a string, after a comma, inside a key, inside
			// a number, right after an opening bracket, and past a token JSON does
			// not know
			const cuts = [
				'{"enrichment": {"industry": {"value": "logis',
				'{"contacts": [{"name": "Ana"},',
				'{"contacts": [{"name": "Ana"}, {"na',
				'{"count": 12',
				'[',
				'  {"a": [1, 2',
				'{"a": +1, "b": "y',
			]

			// THEN each reads as cut off
			for (const cut of cuts) expect(endsBeforeJsonCloses(cut), cut).toBe(true)
		})
	})

	describe('when a reply closes its JSON, or was never JSON', () => {
		it('should say no, since nothing was cut', () => {
			// GIVEN a whole reply, one that closed but broke in the middle, one with
			// a token JSON does not know, one whole with prose cut off after it, a
			// fenced block, a refusal, and an empty body
			const whole = [
				'{"enrichment": {"industry": {"value": "logistics"}}}',
				'{"enrichment": {"industry": {"value": "a" "b"}}}',
				'{"a": 1,}',
				'{"a": NaN}',
				'{"a": 1}\n\nNote: the sources ar',
				'```json\n{"a": 1}\n```',
				'I cannot help with that.',
				'',
			]

			// THEN none reads as cut off
			for (const text of whole)
				expect(endsBeforeJsonCloses(text), text).toBe(false)
		})
	})
})

const parsed = (text: string) =>
	closeCutOffJson(text).map(candidate => JSON.parse(candidate.text))

describe('closeCutOffJson', () => {
	describe('when values arrived whole before the cut', () => {
		it('should offer the reply closed at each open container, most kept first', () => {
			// GIVEN a reply cut in the middle of its second person's title
			const cut =
				'{"enrichment": {"location": {"value": "Barcelona"}}, "contacts": [{"name": "Ana Puig", "role": {"value": "CEO"}}, {"name": "Jordi Vila", "role": {"value": "CTO"'

			// WHEN closed
			const candidates = closeCutOffJson(cut)

			// THEN the title object, the person, the list and the profile are each
			// offered closed, in that order, each keeping less of the text
			const ana = { name: 'Ana Puig', role: { value: 'CEO' } }
			const enrichment = { location: { value: 'Barcelona' } }
			expect(candidates.map(c => JSON.parse(c.text))).toEqual([
				{
					enrichment,
					contacts: [ana, { name: 'Jordi Vila', role: { value: 'CTO' } }],
				},
				{ enrichment, contacts: [ana, { name: 'Jordi Vila' }] },
				{ enrichment, contacts: [ana] },
				{ enrichment },
			])
			const kept = candidates.map(c => c.keptChars)
			expect([...kept].sort((a, b) => b - a)).toEqual(kept)
			expect(kept[0]).toBe(cut.length)
		})

		it('should leave out a key with no value yet, a number the cut may have shortened, a literal cut short, and a list merely opened', () => {
			// GIVEN cuts after a key, after a colon, inside a number, inside a
			// literal, and right after an opening bracket
			const cases: ReadonlyArray<[string, ReadonlyArray<unknown>]> = [
				['{"a": 1, "b"', [{ a: 1 }]],
				['{"a": 1, "b":', [{ a: 1 }]],
				['{"a": [1, 2', [{ a: [1] }]],
				['{"a": true, "b": nul', [{ a: true }]],
				['{"a": "x \\" { y", "b": [', [{ a: 'x " { y' }]],
			]

			// THEN only what is certainly whole is kept, and an empty list is never
			// made up for the one the cut fell in
			for (const [cut, kept] of cases) expect(parsed(cut), cut).toEqual(kept)
		})

		it('should keep what came before a token JSON does not know, and nothing after it', () => {
			// GIVEN replies with a bare word and a number with a leading zero in
			// the middle, each followed by a member written whole
			const cases: ReadonlyArray<[string, ReadonlyArray<unknown>]> = [
				['{"a": 1, "b": NaN, "c": 2, "d": "x', [{ a: 1 }]],
				['{"a": 1, "b": 01, "c": 2, "d": "x', [{ a: 1 }]],
			]

			// THEN the members before the bad token are kept and those after it
			// are not, since no text past it closes into JSON
			for (const [cut, kept] of cases) expect(parsed(cut), cut).toEqual(kept)
		})
	})

	describe('when nothing arrived whole, or nothing was cut', () => {
		it('should offer nothing', () => {
			// GIVEN a reply cut inside its very first value, one cut right after
			// its first list opened, a whole reply, one that closed but broke in the
			// middle, and prose
			const nothing = [
				'{"enrichment": {"industry": {"value": "logis',
				'{"prospects": [',
				'{"a": 1}',
				'{"a": "x" "y"}',
				'not json',
			]

			// THEN there is nothing to keep
			for (const text of nothing)
				expect(closeCutOffJson(text), text).toEqual([])
		})
	})
})
