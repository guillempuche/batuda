import { describe, expect, it } from 'vitest'

import { stripReasoning } from './strip-reasoning'

describe('stripReasoning', () => {
	describe('when a well-formed reasoning block is present', () => {
		it('should drop a leading <think> block and keep the answer', () => {
			// GIVEN the exact shape reported in the field: a think block, then the brief
			const input =
				"<think>\nOkay, let's tackle this query. First I parse the JSON...\n</think>\n\n**Research Brief: Acme**"
			// WHEN stripping runs
			// THEN only the brief survives, trimmed
			expect(stripReasoning(input)).toBe('**Research Brief: Acme**')
		})

		it('should drop several blocks anywhere in the text', () => {
			// GIVEN reasoning blocks before and in the middle of the content
			const input = '<think>a</think>Kept one.<think>b</think> Kept two.'
			// WHEN stripping runs
			// THEN every block goes and the kept text remains
			expect(stripReasoning(input)).toBe('Kept one. Kept two.')
		})

		it('should match the <thinking> variant and any tag casing', () => {
			// GIVEN a <THINKING> block (upper-case, long form)
			const input = '<THINKING>reasoning</THINKING>Answer.'
			// WHEN stripping runs
			// THEN it is removed
			expect(stripReasoning(input)).toBe('Answer.')
		})
	})

	describe('when a tag is unpaired', () => {
		it('should leave a lone closing tag and the text around it untouched', () => {
			// GIVEN a stray </think> with no opening tag — as could appear in a scraped
			// page folded into the agent transcript
			const input = 'A page that mentions </think> in passing.'
			// WHEN stripping runs
			// THEN nothing is removed: dropping text around an unpaired tag would
			// discard real evidence
			expect(stripReasoning(input)).toBe(
				'A page that mentions </think> in passing.',
			)
		})

		it('should leave an unclosed opening tag alone (answer may be missing)', () => {
			// GIVEN a truncated output: an opening tag with no close
			const input = '<think>reasoning that never closed'
			// WHEN stripping runs
			// THEN it is left as-is rather than deleting what might be the only content
			expect(stripReasoning(input)).toBe('<think>reasoning that never closed')
		})
	})

	describe('when there is no reasoning to strip', () => {
		it('should return the text trimmed and otherwise unchanged', () => {
			// GIVEN a clean brief with surrounding whitespace
			const input = '  **Research Brief: Acme**  '
			// WHEN stripping runs
			// THEN it is returned trimmed, untouched
			expect(stripReasoning(input)).toBe('**Research Brief: Acme**')
		})
	})
})
