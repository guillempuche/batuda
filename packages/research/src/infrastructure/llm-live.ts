/**
 * Boot-time LLM provider selection for the three tier services.
 *
 * Each tier (Agent / Extract / Writer) reads its own `RESEARCH_LLM_<TIER>_*`
 * env triple at startup and binds an OpenAI-compatible `LanguageModel.Service`
 * to the matching tag. All real providers expose OpenAI-compatible APIs and
 * are built via `@effect/ai-openai-compat`.
 *
 * Multi-slot cascade: `RESEARCH_LLM_<TIER>_PROVIDERS` is a CSV; slot 0 is the
 * primary, slots 1..N are fallbacks. Each slot is hardened with retry/timeout
 * (see `_harden.ts`) and composed by `withFallbackLanguageModel` — a
 * ProviderError from slot i cascades to slot i+1 only after that slot's retry
 * budget is exhausted.
 *
 * Phase → tier pin:
 *   - Agent   → phase 1 (reasoning + tool loop)
 *   - Extract → phase 2 (structured JSON output)
 *   - Writer  → phase 3 (human-readable brief)
 *
 * Env scheme (capability-named, no auto-resolution):
 *   RESEARCH_LLM_<TIER>_PROVIDERS=together,fireworks,…   (CSV)
 *   RESEARCH_LLM_<TIER>_MODEL=Qwen/Qwen3.5-397B-A17B
 *   RESEARCH_LLM_<TIER>_API_KEY=…                       (slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY_2=…                     (slot 1 via keyForSlot)
 *   RESEARCH_LLM_<TIER>_BASE_URL=…                      (custom vendor only)
 */

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { Config, Effect, Layer, type ServiceMap } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { FetchHttpClient } from 'effect/unstable/http'

import {
	AgentLanguageModel,
	ExtractLanguageModel,
	WriterLanguageModel,
} from '../application/ports'
import { keyForSlot, providerListConfig } from './_config'
import { hardenLanguageModel, withFallbackLanguageModel } from './_harden'
import { type LlmTier, makeCachedLanguageModel } from './cached-llm'
import { stubLanguageModelService } from './stub/llm'

const LLM_VENDORS = [
	'stub',
	'together',
	'fireworks',
	'nebius',
	'groq',
	'novita',
	'sambanova',
	'custom',
] as const

type LlmVendor = (typeof LLM_VENDORS)[number]

const LLM_BASE_URLS = {
	together: 'https://api.together.xyz/v1',
	fireworks: 'https://api.fireworks.ai/inference/v1',
	nebius: 'https://api.studio.nebius.ai/v1',
	groq: 'https://api.groq.com/openai/v1',
	novita: 'https://api.novita.ai/openai/v1',
	sambanova: 'https://api.sambanova.ai/v1',
} as const satisfies Record<Exclude<LlmVendor, 'stub' | 'custom'>, string>

const buildSlot = (
	vendor: LlmVendor,
	envPrefix: string,
	slot: number,
	model: string,
) =>
	Effect.gen(function* () {
		if (vendor === 'stub') return stubLanguageModelService
		const apiKey = yield* Config.redacted(
			keyForSlot(`${envPrefix}_API_KEY`, slot),
		)
		const baseUrl =
			vendor === 'custom'
				? yield* Config.string(keyForSlot(`${envPrefix}_BASE_URL`, slot))
				: LLM_BASE_URLS[vendor]
		const service = yield* OpenAiLanguageModel.make({ model }).pipe(
			Effect.provide(
				OpenAiClient.layer({ apiKey, apiUrl: baseUrl }).pipe(
					Layer.provide(FetchHttpClient.layer),
				),
			),
		)
		return hardenLanguageModel(service, vendor)
	})

const buildTierLayer = <Self>(
	Tag: ServiceMap.Key<Self, LanguageModel.Service>,
	envPrefix: string,
	tier: LlmTier,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const vendors = yield* providerListConfig(
				LLM_VENDORS,
				`${envPrefix}_PROVIDERS`,
			)
			yield* Effect.logInfo(`${envPrefix.toLowerCase()}: ${vendors.join(',')}`)

			if (vendors[0] === 'stub') {
				return Layer.succeed(Tag)(stubLanguageModelService)
			}

			const model = yield* Config.string(`${envPrefix}_MODEL`)
			const slots = yield* Effect.forEach(vendors, (vendor, i) =>
				buildSlot(vendor, envPrefix, i, model),
			)
			const composed = withFallbackLanguageModel(slots)
			return Layer.effect(Tag, makeCachedLanguageModel(composed, tier, model))
		}),
	)

export const makeResearchLlmLive = Layer.mergeAll(
	buildTierLayer(AgentLanguageModel, 'RESEARCH_LLM_AGENT', 'agent'),
	buildTierLayer(ExtractLanguageModel, 'RESEARCH_LLM_EXTRACT', 'extract'),
	buildTierLayer(WriterLanguageModel, 'RESEARCH_LLM_WRITER', 'writer'),
)
