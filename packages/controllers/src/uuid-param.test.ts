import { Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { UuidParam } from './uuid-param'

const decode = Schema.decodeUnknownExit(UuidParam)

describe('UuidParam', () => {
	describe('when the address holds a uuid', () => {
		it('should accept any version, either case, and the all-zero id', () => {
			// GIVEN a random v4 id, a v7 id, an upper-case one, the nil id, and a
			// hand-written fixture id that names no version at all
			const ids = [
				'9f1c2b8e-4d3a-4f6b-9c2d-1e5a7b3c9d0f',
				'01920000-0000-7000-8000-000000000000',
				'9F1C2B8E-4D3A-4F6B-9C2D-1E5A7B3C9D0F',
				'00000000-0000-0000-0000-000000000000',
				'11111111-1111-1111-1111-111111111111',
			]

			// WHEN each is decoded
			// THEN every one passes, as Postgres would take it
			for (const id of ids) expect(decode(id)).toEqual(Exit.succeed(id))
		})
	})

	describe('when the address holds something else', () => {
		it('should refuse it before it reaches the database', () => {
			// GIVEN a slug, an empty value, a truncated id, an id with a stray
			// character, and one wrapped in spaces
			const junk = [
				'not-a-uuid',
				'',
				'9f1c2b8e-4d3a-4f6b-9c2d',
				'9f1c2b8e-4d3a-4f6b-9c2d-1e5a7b3c9d0g',
				' 9f1c2b8e-4d3a-4f6b-9c2d-1e5a7b3c9d0f ',
			]

			// WHEN each is decoded
			// THEN each is refused, so the route answers 400 rather than letting
			// the database's refusal come back as a 500
			for (const value of junk) expect(Exit.isFailure(decode(value))).toBe(true)
		})
	})
})
