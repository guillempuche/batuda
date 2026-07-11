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
 * budget is exhausted. A fallback slot may point at a different vendor whose
 * model id differs, so key / base URL / model are all read per-slot.
 *
 * Phase → tier pin:
 *   - Agent   → phase 1 (reasoning + tool loop)
 *   - Extract → phase 2 (structured JSON output)
 *   - Writer  → phase 3 (human-readable brief)
 *
 * Env scheme (capability-named, no auto-resolution):
 *   RESEARCH_LLM_<TIER>_PROVIDERS=nebius,groq,…          (CSV, slot 0 primary)
 *   RESEARCH_LLM_<TIER>_MODEL=Qwen/Qwen3-32B             (slot 0)
 *   RESEARCH_LLM_<TIER>_MODEL_2=qwen/qwen3.6-27b         (slot 1; defaults to slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY=…                        (slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY_2=…                      (slot 1 via keyForSlot)
 *   RESEARCH_LLM_<TIER>_BASE_URL=…                       (custom vendor only)
 *   RESEARCH_LLM_<TIER>_TIMEOUT_SEC=60                   (per-call; default 60/90/60)
 */

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { Config, type Duration, Effect, Layer, type ServiceMap } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { FetchHttpClient } from 'effect/unstable/http'

import {
	AgentLanguageModel,
	ExtractLanguageModel,
	WriterLanguageModel,
} from '../application/ports'
import { keyForSlot, providerListConfig } from './_config'
import { hardenLanguageModel, withFallbackLanguageModel } from './_harden'
import { tolerateNullServiceTier } from './_service-tier'
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

// Per-call timeout defaults by tier. Extract runs the largest model (structured
// JSON over a 235B) so it gets a longer leash than the agent / writer tiers;
// each is overridable via `RESEARCH_LLM_<TIER>_TIMEOUT_SEC`.
const DEFAULT_TIMEOUT_SEC: Record<LlmTier, number> = {
	agent: 60,
	extract: 90,
	writer: 60,
}

const buildSlot = (
	vendor: LlmVendor,
	envPrefix: string,
	slot: number,
	model: string,
	timeout: Duration.Input,
	tier: LlmTier,
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
				OpenAiClient.layer({
					apiKey,
					apiUrl: baseUrl,
					// Qwen's OpenAI-compatible endpoint returns `service_tier: null`,
					// which the client's response schema rejects; strip it before decode.
					transformClient: tolerateNullServiceTier,
				}).pipe(Layer.provide(FetchHttpClient.layer)),
			),
		)
		return hardenLanguageModel(service, vendor, { timeout, tier })
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
			const timeoutSeconds = yield* Config.int(`${envPrefix}_TIMEOUT_SEC`).pipe(
				Config.withDefault(DEFAULT_TIMEOUT_SEC[tier]),
			)
			const timeout: Duration.Input = `${timeoutSeconds} seconds`
			const slots = yield* Effect.forEach(vendors, (vendor, i) =>
				Effect.gen(function* () {
					// A fallback slot may run a different provider whose model id
					// differs (`qwen/qwen3.6-27b` on Groq vs `Qwen/Qwen3-32B` on
					// Nebius), so each slot reads its own model. Slot 0 is the tier's
					// base model; later slots default to it when they share the id.
					const slotModel =
						i === 0
							? model
							: yield* Config.string(keyForSlot(`${envPrefix}_MODEL`, i)).pipe(
									Config.withDefault(model),
								)
					const service = yield* buildSlot(
						vendor,
						envPrefix,
						i,
						slotModel,
						timeout,
						tier,
					)
					return { service, model: slotModel }
				}),
			)
			// Cache each slot on its own so the row records the model that actually
			// answered; every slot keys on the tier's primary model, so a cached
			// answer is reused no matter which slot produced it and a hit never
			// re-hits a provider.
			return Layer.effect(
				Tag,
				Effect.map(
					Effect.forEach(slots, ({ service, model: answered }) =>
						makeCachedLanguageModel(service, tier, model, answered),
					),
					withFallbackLanguageModel,
				),
			)
		}),
	)

export const makeResearchLlmLive = Layer.mergeAll(
	buildTierLayer(AgentLanguageModel, 'RESEARCH_LLM_AGENT', 'agent'),
	buildTierLayer(ExtractLanguageModel, 'RESEARCH_LLM_EXTRACT', 'extract'),
	buildTierLayer(WriterLanguageModel, 'RESEARCH_LLM_WRITER', 'writer'),
)
