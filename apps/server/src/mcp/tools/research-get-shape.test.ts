import { describe, expect, it } from 'vitest'

import { withAppliedInstructions } from './research-mcp'

// What a caller gets back when it asks about a run.
//
// Every real call today came back over the size a tool result may be — 68k to
// 161k characters — and nearly all of it was the list of pages the run read. A
// caller polling for findings paid for that list on every check and could not
// read the answer at all.

// A run as the detail query returns it, cut down to the fields this shapes.
const runWith = (sources: ReadonlyArray<unknown>, status = 'succeeded') =>
	({
		id: 'run-1',
		status,
		templateNames: ['Prospecció'],
		instructionSegments: [{ text: 'x'.repeat(9000) }],
		sources,
		links: [],
		children: [],
	}) as unknown as Parameters<typeof withAppliedInstructions>[0]

const pages = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ url: `https://p${i}.test` }))

describe('shaping a research run for a caller', () => {
	describe('when nothing extra is asked for', () => {
		it('should say how many pages were read without listing them', () => {
			// GIVEN a wide scan that read 139 pages, the size that broke every call
			const shaped = withAppliedInstructions(runWith(pages(139))) as {
				sources?: unknown
				source_count?: number
			}

			// THEN the count is there, and the list is not
			expect(shaped.source_count).toBe(139)
			expect(shaped.sources).toBeUndefined()
		})

		it('should leave the instruction text out as it always has', () => {
			const shaped = withAppliedInstructions(runWith(pages(2))) as {
				instructionSegments?: unknown
			}
			expect(shaped.instructionSegments).toBeUndefined()
		})
	})

	describe('when the pages are asked for', () => {
		it('should send the list, and still say how many there were', () => {
			// GIVEN a caller that passed include:['sources']
			const shaped = withAppliedInstructions(
				runWith(pages(3)),
				false,
				true,
			) as { sources?: ReadonlyArray<unknown>; source_count?: number }

			// THEN it gets every page, and the count alongside
			expect(shaped.sources).toHaveLength(3)
			expect(shaped.source_count).toBe(3)
		})

		it('should keep the two asks independent of each other', () => {
			// GIVEN a caller that asked only for the instruction text
			const shaped = withAppliedInstructions(runWith(pages(3)), true) as {
				sources?: unknown
				instructionSegments?: unknown
			}

			// THEN it gets the text and not the pages
			expect(shaped.instructionSegments).toBeDefined()
			expect(shaped.sources).toBeUndefined()
		})
	})

	describe('when a run read nothing at all', () => {
		it('should say zero rather than leave the question open', () => {
			// GIVEN a run that failed before fetching anything
			const shaped = withAppliedInstructions(runWith([], 'failed')) as {
				source_count?: number
			}

			// THEN the count is zero, not missing — a reader can tell "read nothing"
			// from "was not told"
			expect(shaped.source_count).toBe(0)
		})
	})
})
