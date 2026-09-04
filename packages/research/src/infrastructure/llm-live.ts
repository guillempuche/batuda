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
 *   RESEARCH_LLM_<TIER>_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507  (slot 0)
 *   RESEARCH_LLM_<TIER>_MODEL_2=openai/gpt-oss-120b      (slot 1; defaults to slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY=…                        (slot 0)
 *   RESEARCH_LLM_<TIER>_API_KEY_2=…                      (slot 1 via keyForSlot)
 *   RESEARCH_LLM_<TIER>_BASE_URL=…                       (custom vendor only)
 *   RESEARCH_LLM_<TIER>_TIMEOUT_SEC=90                   (per-call; default 90)
 */

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat'
import {
	Config,
	type Context,
	type Duration,
	Effect,
	Layer,
	Option,
} from 'effect'
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

// Where each tier's settings live, written in the order a run goes through the
// tiers, because `LLM_TIERS` below takes its order from this table.
const TIER_ENV_PREFIX: Record<LlmTier, string> = {
	agent: 'RESEARCH_LLM_AGENT',
	extract: 'RESEARCH_LLM_EXTRACT',
	writer: 'RESEARCH_LLM_WRITER',
}

/** Every model tier, in the order a run goes through them. */
export const LLM_TIERS = Object.keys(TIER_ENV_PREFIX) as ReadonlyArray<LlmTier>

/** A tier, and the vendor that would really answer for it. */
export interface ResolvedTier {
	readonly tier: LlmTier
	/** `stub` means canned answers: nothing live is behind this tier. */
	readonly vendor: LlmVendor
}

// The tiers a caller asked about, in the order a run goes through them and each
// named once: taking the caller's array as it came would read a tier twice when
// it was named twice, and would let the order somebody happened to type decide
// the order a refusal names them in.
const tiersInRunOrder = (
	tiers: ReadonlyArray<LlmTier>,
): ReadonlyArray<LlmTier> => LLM_TIERS.filter(tier => tiers.includes(tier))

/**
 * The vendor each tier would really answer with, read the same way the layer that
 * builds it reads them — the first choice decides, because that is what the layer
 * itself keys on when it swaps a whole tier for canned answers.
 *
 * This exists so a caller can find out that a tier is stubbed without owning a copy
 * of the vendor names, which live in one tuple here on purpose.
 */
export const resolvedTierVendors = (
	tiers: ReadonlyArray<LlmTier> = LLM_TIERS,
): Effect.Effect<ReadonlyArray<ResolvedTier>, Config.ConfigError> =>
	Effect.forEach(tiersInRunOrder(tiers), tier =>
		providerListConfig(LLM_VENDORS, `${TIER_ENV_PREFIX[tier]}_PROVIDERS`).pipe(
			Effect.map(vendors => ({ tier, vendor: vendors[0] })),
		),
	)

/** Every vendor a tier is pointed at, first choice first — never empty. */
type NonEmptyVendorList = ReadonlyArray<LlmVendor> & { readonly 0: LlmVendor }

// The models behind a tier's vendor list, once that list is in hand. It sits
// apart from reading the list so the two readers below differ on what silence
// means and on nothing else.
const slotsForVendors = (
	tier: LlmTier,
	vendors: NonEmptyVendorList,
): Effect.Effect<ReadonlyArray<ConfiguredSlot>, Config.ConfigError> =>
	Effect.gen(function* () {
		const envPrefix = TIER_ENV_PREFIX[tier]
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
	})

/**
 * Every model the settings point a tier at.
 *
 * Read the same way a run reads them, so anything checking the settings is
 * looking at what a run would really use. Working this out separately would be
 * a second reading of the same settings, free to drift from the first and
 * report on models nothing runs.
 *
 * Stubbed tiers are left out: they reach no vendor, so there is nothing to ask.
 * A tier nobody named a vendor for stops the read instead, since a tier a run
 * needs and nobody set is a fault.
 */
export const configuredSlots = (
	tiers: ReadonlyArray<LlmTier> = LLM_TIERS,
): Effect.Effect<ReadonlyArray<ConfiguredSlot>, Config.ConfigError> =>
	Effect.forEach(tiersInRunOrder(tiers), tier =>
		providerListConfig(LLM_VENDORS, `${TIER_ENV_PREFIX[tier]}_PROVIDERS`).pipe(
			Effect.flatMap(vendors => slotsForVendors(tier, vendors)),
		),
	).pipe(Effect.map(nested => nested.flat()))

/**
 * `configuredSlots` for one tier, except that a tier nobody named a vendor for
 * comes back empty instead of stopping the read.
 *
 * The two callers want opposite things from silence. A check of the models a run
 * uses has to say which setting is missing, because a tier a run needs and
 * nobody set is a fault. A check that only reports on what is configured has to
 * carry on, because a tier nobody set reaches no vendor — and reading them all
 * through the strict one would let a single unset tier hide the tiers beside it.
 *
 * Empty covers both ways a tier reaches nothing, the unset one and the stubbed
 * one, because a caller that only reports has no use for the difference.
 */
export const configuredSlotsIfSet = (
	tier: LlmTier,
): Effect.Effect<ReadonlyArray<ConfiguredSlot>, Config.ConfigError> =>
	Config.option(
		providerListConfig(LLM_VENDORS, `${TIER_ENV_PREFIX[tier]}_PROVIDERS`),
	).pipe(
		Effect.flatMap(configured =>
			Option.isNone(configured)
				? Effect.succeed<ReadonlyArray<ConfiguredSlot>>([])
				: slotsForVendors(tier, configured.value),
		),
	)

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
					// differs (`openai/gpt-oss-120b` on Groq vs a Qwen model on
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
					return { service, model: slotModel, rate, vendor }
				}),
			)
			// Cache each slot on its own so the row records the model that actually
			// answered; every slot keys on the tier's primary model, so a cached
			// answer is reused no matter which slot produced it and a hit never
			// re-hits a provider.
			return Layer.effect(
				Tag,
				Effect.map(
					Effect.forEach(slots, ({ service, model: answered, rate, vendor }) =>
						makeCachedLanguageModel(
							service,
							tier,
							model,
							answered,
							rate,
							vendor,
						),
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
