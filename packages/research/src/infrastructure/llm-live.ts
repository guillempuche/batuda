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
 *   RESEARCH_LLM_<TIER>_MODEL_2=openai/gpt-oss-120b      (slot 1; defaults to slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY=…                        (slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY_2=…                      (slot 1 via keyForSlot)
 *   RESEARCH_LLM_<TIER>_BASE_URL=…                       (custom vendor only)
 *   RESEARCH_LLM_<TIER>_TIMEOUT_SEC=90                   (per-call; default 90)
 */

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import { Config, type Context, type Duration, Effect, Layer } from 'effect'
import type { LanguageModel } from 'effect/unstable/ai'
import { FetchHttpClient } from 'effect/unstable/http'

import {
	AgentLanguageModel,
	ExtractLanguageModel,
	WriterLanguageModel,
} from '../application/ports'
import { keyForSlot, providerListConfig } from './_config'
import { hardenLanguageModel, withFallbackLanguageModel } from './_harden'
import { tolerateVendorReplyShape } from './_reply-shape'
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

export type LlmVendor = (typeof LLM_VENDORS)[number]

const LLM_BASE_URLS = {
	together: 'https://api.together.xyz/v1',
	fireworks: 'https://api.fireworks.ai/inference/v1',
	nebius: 'https://api.studio.nebius.ai/v1',
	groq: 'https://api.groq.com/openai/v1',
	novita: 'https://api.novita.ai/openai/v1',
	sambanova: 'https://api.sambanova.ai/v1',
} as const satisfies Record<Exclude<LlmVendor, 'stub' | 'custom'>, string>

/** One model a tier is configured to reach, and how to reach it. */
export interface ConfiguredSlot {
	readonly tier: LlmTier
	/** 1 for a tier's first choice, 2 for what it falls back to. */
	readonly slot: number
	readonly vendor: string
	readonly model: string
	readonly baseUrl: string
	/** The variable holding this slot's key — named, never read here. */
	readonly apiKeyEnv: string
}

/**
 * Every model the settings point a tier at.
 *
 * Read the same way a run reads them, so anything checking the settings is
 * looking at what a run would really use. Working this out separately would be
 * a second reading of the same settings, free to drift from the first and
 * report on models nothing runs.
 *
 * Stubbed tiers are left out: they reach no vendor, so there is nothing to ask.
 */
const LLM_TIERS: ReadonlyArray<{
	readonly envPrefix: string
	readonly tier: LlmTier
}> = [
	{ envPrefix: 'RESEARCH_LLM_AGENT', tier: 'agent' },
	{ envPrefix: 'RESEARCH_LLM_EXTRACT', tier: 'extract' },
	{ envPrefix: 'RESEARCH_LLM_WRITER', tier: 'writer' },
]

/** A tier, and the vendor that would really answer for it. */
export interface ResolvedTier {
	readonly tier: LlmTier
	/** `stub` means canned answers: nothing live is behind this tier. */
	readonly vendor: LlmVendor
}

/**
 * The vendor each tier would really answer with, read the same way the layer that
 * builds it reads them — the first choice decides, because that is what the layer
 * itself keys on when it swaps a whole tier for canned answers.
 *
 * This exists so a caller can find out that a tier is stubbed without owning a copy
 * of the vendor names, which live in one tuple here on purpose.
 */
export const resolvedTierVendors = (
	tiers: ReadonlyArray<LlmTier> = LLM_TIERS.map(entry => entry.tier),
): Effect.Effect<ReadonlyArray<ResolvedTier>, Config.ConfigError> =>
	Effect.forEach(
		LLM_TIERS.filter(entry => tiers.includes(entry.tier)),
		({ envPrefix, tier }) =>
			providerListConfig(LLM_VENDORS, `${envPrefix}_PROVIDERS`).pipe(
				Effect.map(vendors => ({ tier, vendor: vendors[0] })),
			),
	)

export const configuredSlots = (
	tiers: ReadonlyArray<{
		readonly envPrefix: string
		readonly tier: LlmTier
	}> = LLM_TIERS,
): Effect.Effect<ReadonlyArray<ConfiguredSlot>, Config.ConfigError> =>
	Effect.forEach(tiers, ({ envPrefix, tier }) =>
		Effect.gen(function* () {
			const vendors = yield* providerListConfig(
				LLM_VENDORS,
				`${envPrefix}_PROVIDERS`,
			)
			// A tier whose first choice is the stub runs wholly on the stub, and the
			// layer that builds it decides that on the first choice alone and never
			// asks for a model. Asking here would fail a tier nobody gave a model to
			// precisely because it was never going to need one.
			if (vendors[0] === 'stub') return []
			const model = yield* Config.string(`${envPrefix}_MODEL`)
			return yield* Effect.forEach(vendors, (vendor, i) =>
				Effect.gen(function* () {
					if (vendor === 'stub') return []
					const slotModel =
						i === 0
							? model
							: yield* Config.string(keyForSlot(`${envPrefix}_MODEL`, i)).pipe(
									Config.withDefault(model),
								)
					const baseUrl =
						vendor === 'custom'
							? yield* Config.string(keyForSlot(`${envPrefix}_BASE_URL`, i))
							: LLM_BASE_URLS[vendor]
					return [
						{
							tier,
							slot: i + 1,
							vendor,
							model: slotModel,
							baseUrl,
							apiKeyEnv: keyForSlot(`${envPrefix}_API_KEY`, i),
						} satisfies ConfiguredSlot,
					]
				}),
			).pipe(Effect.map(nested => nested.flat()))
		}),
	).pipe(Effect.map(nested => nested.flat()))

// How long one model call may take before it is given up on, per tier. The
// models these tiers run routinely think for the better part of a minute, so a
// shorter leash cuts off answers that were on their way rather than catching a
// stuck endpoint. Each is overridable via `RESEARCH_LLM_<TIER>_TIMEOUT_SEC`.
const DEFAULT_TIMEOUT_SEC: Record<LlmTier, number> = {
	agent: 90,
	extract: 90,
	writer: 90,
}

// What this slot charges, per thousand tokens each way. Required with no
// fallback, and read per slot, because the same model costs different amounts at
// different vendors — so a fallback slot is priced at whoever answered. A stub
// slot bills nobody, so it is free.
const slotRate = (vendor: LlmVendor, envPrefix: string, slot: number) =>
	vendor === 'stub'
		? Effect.succeed({ inCentsPer1k: 0, outCentsPer1k: 0 })
		: Effect.gen(function* () {
				const inCentsPer1k = yield* Config.finite(
					keyForSlot(`${envPrefix}_PRICE_IN_CENTS_PER_1K`, slot),
				)
				const outCentsPer1k = yield* Config.finite(
					keyForSlot(`${envPrefix}_PRICE_OUT_CENTS_PER_1K`, slot),
				)
				return { inCentsPer1k, outCentsPer1k }
			})

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
					// OpenAI-compatible endpoints vary on fields the client's response
					// schema demands (Qwen's returns `service_tier: null`); normalize
					// the reply before decode so a usable answer is not thrown away.
					transformClient: tolerateVendorReplyShape,
				}).pipe(Layer.provide(FetchHttpClient.layer)),
			),
		)
		return hardenLanguageModel(service, vendor, { timeout, tier })
	})

const buildTierLayer = <Self>(
	Tag: Context.Key<Self, LanguageModel.Service>,
	envPrefix: string,
	tier: LlmTier,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const vendors = yield* providerListConfig(
				LLM_VENDORS,
				`${envPrefix}_PROVIDERS`,
			)
			yield* Effect.logInfo('research.providers.configured').pipe(
				Effect.annotateLogs({
					event: 'research.providers.configured',
					port: envPrefix.toLowerCase(),
					vendors,
				}),
			)

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
					// differs (`openai/gpt-oss-120b` on Groq vs `Qwen/Qwen3-32B` on
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
					const rate = yield* slotRate(vendor, envPrefix, i)
					return { service, model: slotModel, rate }
				}),
			)
			// Cache each slot on its own so the row records the model that actually
			// answered; every slot keys on the tier's primary model, so a cached
			// answer is reused no matter which slot produced it and a hit never
			// re-hits a provider.
			return Layer.effect(
				Tag,
				Effect.map(
					Effect.forEach(slots, ({ service, model: answered, rate }) =>
						makeCachedLanguageModel(service, tier, model, answered, rate),
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
