/**
 * Stub LanguageModel — returns deterministic text without calling any inference API.
 *
 * Pattern: Layer.succeed (no dependencies, no I/O, no cost).
 * Used when RESEARCH_LLM_PROVIDER=stub for zero-cost local development.
 *
 * The stub returns fixed text for generateText/generateObject/streamText.
 * Tool calls are never emitted — the research pipeline sees an LLM that
 * immediately returns a summary without gathering data. This is fine for
 * testing the pipeline mechanics (fiber lifecycle, status transitions,
 * findings persistence) without needing real inference.
 */

import { Effect, Layer, Stream } from 'effect'
import { LanguageModel } from 'effect/unstable/ai'

const STUB_TEXT =
	'Acme Corp S.L. (CIF B12345678) is a Barcelona-based industrial solutions company founded in 2005. ' +
	'They employ 85 people and reported €12M revenue in 2025. Key focus: industrial automation.'

const stubResponse = {
	text: STUB_TEXT,
	content: [{ type: 'text' as const, text: STUB_TEXT }],
	reasoning: [],
	reasoningText: undefined,
	toolCalls: [],
	toolResults: [],
	finishReason: 'stop' as const,
	usage: {
		inputTokens: {
			uncached: undefined,
			total: 0,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: 0, text: undefined, reasoning: undefined },
	},
}

export const StubLanguageModel = Layer.succeed(LanguageModel.LanguageModel)(
	LanguageModel.LanguageModel.of({
		generateText: (_options: unknown) => Effect.succeed(stubResponse) as never,
		generateObject: (_options: unknown) =>
			Effect.succeed({
				...stubResponse,
				value: {
					company_name: 'Acme Corp S.L.',
					tax_id: 'B12345678',
					summary: STUB_TEXT,
				},
			}) as never,
		streamText: (_options: unknown) =>
			Stream.succeed({
				type: 'text-delta' as const,
				delta: STUB_TEXT,
			}) as never,
	}),
)
