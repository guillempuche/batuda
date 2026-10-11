import { describe, expect, it } from 'vitest'

import { sha256Hex, stableStringify } from './stable-hash'

describe('stableStringify', () => {
	describe('when the same fields arrive in a different order', () => {
		it('should serialize them identically', () => {
			// GIVEN two objects with the same entries in different orders
			// THEN the serializations match, keys sorted
			expect(stableStringify({ b: 2, a: 1 })).toBe(
				stableStringify({ a: 1, b: 2 }),
			)
			expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
		})
	})

	describe('when the value carries things JSON cannot hold', () => {
		it('should keep the output every cache key was built on', () => {
			// GIVEN the awkward values a hints object or a model call can carry
			const shared = { k: 1 }
			const cyclic: Record<string, unknown> = { a: 1 }
			cyclic['self'] = cyclic
			const input = {
				z: undefined,
				n: Number.NaN,
				f: () => undefined,
				list: [undefined, () => 1, 2],
				when: new Date(0),
				twice: [shared, shared],
				cyclic,
				nested: { b: [3, { d: 1, c: 2 }], a: 'x' },
			}

			// THEN the bytes are exactly these — a change here moves every stored
			// research and model cache key at once
			expect(stableStringify(input)).toBe(
				'{"cyclic":{"a":1,"self":"[circular]"},"list":[null,null,2],"n":null,"nested":{"a":"x","b":[3,{"c":2,"d":1}]},"twice":[{"k":1},"[circular]"],"when":{}}',
			)
		})

		it('should refuse a bigint, as JSON.stringify does', () => {
			// GIVEN a value JSON cannot write
			// THEN the serializer throws rather than inventing a form for it
			expect(() => stableStringify({ big: 1n })).toThrow()
		})
	})
})

describe('sha256Hex', () => {
	it('should write the digest as lowercase hex', () => {
		// GIVEN a known input
		// THEN the known SHA-256 digest comes back, in lowercase
		expect(sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		)
	})
})
