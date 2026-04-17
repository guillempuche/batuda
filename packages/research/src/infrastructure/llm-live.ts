/**
 * Boot-time LLM provider selection layer.
 *
 * Reads RESEARCH_PROVIDER_LLM env var at startup and returns the
 * matching Layer that provides LanguageModel. All real providers
 * use @effect/ai-openai-compat since they expose OpenAI-compatible APIs.
 *
 * Env vars:
 *   RESEARCH_PROVIDER_LLM  — stub | groq | fireworks | nebius | together | sambanova | custom
 *   RESEARCH_MODEL_LLM     — model name (required when not stub)
 *   RESEARCH_API_KEY_LLM   — API key (required when not stub)
 *   RESEARCH_BASE_URL_LLM  — override base URL (only for custom)
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
		const provider = yield* Config.string('RESEARCH_PROVIDER_LLM')
		yield* Effect.logInfo(`research.llm: ${provider}`)

		if (provider === 'stub') return StubLanguageModel

		const model = yield* Config.string('RESEARCH_MODEL_LLM')
		const apiKey = yield* Config.redacted('RESEARCH_API_KEY_LLM')
		const baseUrl =
			provider === 'custom'
				? yield* Config.string('RESEARCH_BASE_URL_LLM')
				: LLM_BASE_URLS[provider]

		if (!baseUrl) {
			return yield* Effect.die(
				new Error(
					`Unknown RESEARCH_PROVIDER_LLM: '${provider}'. ` +
						`Use one of: stub, ${Object.keys(LLM_BASE_URLS).join(', ')}, custom`,
				),
			)
		}

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
