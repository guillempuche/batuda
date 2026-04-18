/**
 * Stub LanguageModel — returns deterministic text without calling any inference API.
 *
 * Reusable service value bound to any tier tag (Agent/Extract/Writer) in
 * llm-live.ts. Zero-cost, deterministic, used for tests + local dev.
 */

import { Effect, Stream } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'

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

export const stubLanguageModelService: LanguageModel.Service = {
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
}
