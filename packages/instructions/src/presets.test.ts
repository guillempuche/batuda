import { describe, expect, it } from 'vitest'

import { agents } from './domain'
import { instructionPresets, presetById, presetsForAgent } from './presets'

describe('instructionPresets', () => {
	describe('when the catalog is loaded', () => {
		it('should have unique preset ids', () => {
			// GIVEN every preset id [presets.ts:16]
			const ids = instructionPresets.map(p => p.id)
			// THEN none collide (an import records source_preset_id by it)
			expect(new Set(ids).size).toBe(ids.length)
		})

		it('should give every preset a non-empty name and body', () => {
			// GIVEN each catalog entry [presets.ts:16]
			for (const preset of instructionPresets) {
				// THEN it carries real, importable text
				expect(preset.name.trim().length).toBeGreaterThan(0)
				expect(preset.body.trim().length).toBeGreaterThan(0)
			}
		})

		it('should only reference known agents', () => {
			// GIVEN each catalog entry [presets.ts:16]
			for (const preset of instructionPresets) {
				// THEN its agent is in the code-defined set
				expect([...agents]).toContain(preset.agent)
			}
		})
	})
})

describe('presetById', () => {
	describe('when the id exists', () => {
		it('should round-trip the catalog entry', () => {
			// GIVEN the first catalog entry [presets.ts:54]
			const first = instructionPresets[0]
			expect(first).toBeDefined()
			// THEN looking it up by id returns the same entry
			if (first) expect(presetById(first.id)).toEqual(first)
		})
	})

	describe('when the id is unknown', () => {
		it('should return undefined', () => {
			// GIVEN an id no preset uses [presets.ts:54]
			// THEN the lookup misses cleanly
			expect(presetById('does-not-exist')).toBeUndefined()
		})
	})
})

describe('presetsForAgent', () => {
	describe('when an agent has presets', () => {
		it('should return only presets for the requested agent', () => {
			// GIVEN the research agent [presets.ts:57]
			const research = presetsForAgent('research')
			// THEN every returned preset targets research, and there is at least one
			expect(research.length).toBeGreaterThan(0)
			expect(research.every(p => p.agent === 'research')).toBe(true)
		})
	})
})
