import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { TaskActorKind } from './task-events'

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(schema)(input)

describe('TaskActorKind', () => {
	it('should accept user and agent', () => {
		// GIVEN the two allowed actor kinds
		// WHEN each is decoded independently
		// THEN both round-trip — the agent badge in the undo drawer depends on
		// this union staying stable
		for (const value of ['user', 'agent'] as const) {
			expect(Schema.decodeUnknownSync(TaskActorKind)(value)).toBe(value)
		}
	})

	it('should reject unknown actor kinds like "system"', () => {
		// GIVEN 'system' (plausible but not modelled — system-driven changes
		// route through actor_id=NULL, not a third kind)
		// THEN decode fails
		const exit = decodeExit(TaskActorKind, 'system')
		expect(exit._tag).toBe('Failure')
	})
})
