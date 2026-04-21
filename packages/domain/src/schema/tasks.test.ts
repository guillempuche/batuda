import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { TaskPriority, TaskSource, TaskStatus } from './tasks'

const decodeExit = <S extends Schema.Decoder<unknown>>(
	schema: S,
	input: unknown,
) => Schema.decodeUnknownExit(schema)(input)

describe('TaskStatus', () => {
	it('should accept every literal in the DB CHECK mirror', () => {
		// GIVEN the six allowed status values
		// WHEN each is decoded independently
		// THEN every one round-trips — this test pins the enum against
		// accidental removals/additions that would drift from the CHECK
		// constraint in `0001_initial.ts`
		for (const value of [
			'open',
			'in_progress',
			'blocked',
			'in_review',
			'done',
			'cancelled',
		] as const) {
			expect(Schema.decodeUnknownSync(TaskStatus)(value)).toBe(value)
		}
	})

	it('should reject an unknown literal like "archived"', () => {
		// GIVEN 'archived' (not in the union)
		// WHEN decode runs
		// THEN it fails — guards against typos in callers and the inbox UI
		const exit = decodeExit(TaskStatus, 'archived')
		expect(exit._tag).toBe('Failure')
	})
})

describe('TaskSource', () => {
	it('should accept every literal in the source union', () => {
		// GIVEN the five allowed source values (incl. 'booking' — vendor-neutral
		// rename of the pre-plan 'calcom')
		// WHEN each is decoded independently
		// THEN every one round-trips
		for (const value of [
			'user',
			'agent',
			'webhook',
			'email',
			'booking',
		] as const) {
			expect(Schema.decodeUnknownSync(TaskSource)(value)).toBe(value)
		}
	})

	it('should reject the pre-plan "calcom" source', () => {
		// GIVEN 'calcom' (the old vendor-named value)
		// WHEN decode runs
		// THEN it fails — we deliberately renamed to 'booking' so the calendar
		// backend can swap without touching existing rows
		const exit = decodeExit(TaskSource, 'calcom')
		expect(exit._tag).toBe('Failure')
	})

	it('should reject unknown sources like "cron"', () => {
		// GIVEN 'cron' (plausible but not modelled)
		// THEN decode fails
		const exit = decodeExit(TaskSource, 'cron')
		expect(exit._tag).toBe('Failure')
	})
})

describe('TaskPriority', () => {
	it('should accept low | normal | high', () => {
		// GIVEN the three allowed priority values
		// WHEN each is decoded independently
		// THEN every one round-trips
		for (const value of ['low', 'normal', 'high'] as const) {
			expect(Schema.decodeUnknownSync(TaskPriority)(value)).toBe(value)
		}
	})

	it('should reject unknown priorities like "urgent"', () => {
		// GIVEN 'urgent' (plausible extension that would need explicit opt-in)
		// THEN decode fails
		const exit = decodeExit(TaskPriority, 'urgent')
		expect(exit._tag).toBe('Failure')
	})
})
