/**
 * Boot-time LLM provider selection layer.
 *
 * Reads RESEARCH_LLM_PROVIDER env var at startup and returns the
 * matching Layer that provides LanguageModel. All real providers
 * use @effect/ai-openai-compat since they expose OpenAI-compatible APIs.
 *
 * Env vars:
 *   RESEARCH_LLM_PROVIDER  — stub | groq | fireworks | nebius | together | sambanova | custom
 *   RESEARCH_LLM_MODEL     — model name (required when not stub)
 *   RESEARCH_LLM_API_KEY   — API key (required when not stub)
 *   RESEARCH_LLM_BASE_URL  — override base URL (only for custom)
 */

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { Config, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'

import { StubLanguageModel } from './stub/llm'

const LLM_BASE_URLS: Record<string, string> = {
	groq: 'https://api.groq.com/openai/v1',
	fireworks: 'https://api.fireworks.ai/inference/v1',
	nebius: 'https://api.studio.nebius.ai/v1',
	together: 'https://api.together.xyz/v1',
	sambanova: 'https://api.sambanova.ai/v1',
}

export const makeResearchLlmLive = Layer.unwrap(
	Effect.gen(function* () {
		const provider = yield* Config.string('RESEARCH_LLM_PROVIDER')
		yield* Effect.logInfo(`research.llm: ${provider}`)

		if (provider === 'stub') return StubLanguageModel

		const model = yield* Config.string('RESEARCH_LLM_MODEL')
		const apiKey = yield* Config.redacted('RESEARCH_LLM_API_KEY')
		const baseUrl =
			provider === 'custom'
				? yield* Config.string('RESEARCH_LLM_BASE_URL')
				: LLM_BASE_URLS[provider]

		if (!baseUrl) {
			return yield* Effect.die(
				new Error(
					`Unknown RESEARCH_LLM_PROVIDER: '${provider}'. ` +
						`Use one of: stub, ${Object.keys(LLM_BASE_URLS).join(', ')}, custom`,
				),
			)
		}

		// Model extends Layer — provides LanguageModel, requires OpenAiClient
		return OpenAiLanguageModel.model(model).pipe(
			Layer.provide(
				OpenAiClient.layer({
					apiKey,
					apiUrl: baseUrl,
				}),
			),
			Layer.provide(FetchHttpClient.layer),
		)
	}),
)
