import { Cause, ConfigProvider, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import type { LlmTier } from './cached-llm'
import {
	type ConfiguredSlot,
	configuredSlots,
	configuredSlotsIfSet,
	resolvedTierVendors,
} from './llm-live'

/**
 * Which models the settings point each tier at.
 *
 * This is read the same way a run reads it, so a check on the settings is
 * looking at what a run would really use rather than at a second reading free
 * to drift from the first.
 */
const read = (env: Record<string, string>) =>
	Effect.runPromiseExit(
		configuredSlots().pipe(
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
		),
	)

const slotsOf = (
	exit: Exit.Exit<ReadonlyArray<ConfiguredSlot>, unknown>,
): ReadonlyArray<ConfiguredSlot> => (Exit.isSuccess(exit) ? exit.value : [])

const reasonOf = (exit: Exit.Exit<unknown, unknown>): string =>
	Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ''

// The other two tiers stubbed out, so a case can say one thing about one tier
// without spelling out settings for all three. Neither stubbed tier is given a
// model, because a stubbed tier never needs one.
const AGENT_ON_GROQ = {
	RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
	RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
	RESEARCH_LLM_AGENT_PROVIDERS: 'groq',
	RESEARCH_LLM_AGENT_MODEL: 'openai/gpt-oss-120b',
}

describe('the models a tier is pointed at', () => {
	describe('when a tier names a vendor that carries its own address', () => {
		it('should work out where to reach it without being told', async () => {
			// GIVEN a tier on a named vendor
			const slots = slotsOf(await read(AGENT_ON_GROQ))

			// WHEN the settings are read — THEN the address comes from the vendor,
			// and only a `custom` vendor has to be given one
			expect(slots).toHaveLength(1)
			expect(slots[0]?.vendor).toBe('groq')
			expect(slots[0]?.baseUrl).toContain('groq.com')
			expect(slots[0]?.apiKeyEnv).toBe('RESEARCH_LLM_AGENT_API_KEY')
		})
	})

	describe('when a tier has a second choice on the same vendor', () => {
		it('should reach for the same model unless told otherwise', async () => {
			// GIVEN a second choice with no model of its own
			const slots = slotsOf(
				await read({
					...AGENT_ON_GROQ,
					RESEARCH_LLM_AGENT_PROVIDERS: 'groq,groq',
				}),
			)

			// WHEN read — THEN both slots name the tier's model, because two vendors
			// serving the same model is a real arrangement, and the second slot is
			// asked for under its own name
			expect(slots.map(s => s.model)).toEqual([
				'openai/gpt-oss-120b',
				'openai/gpt-oss-120b',
			])
			expect(slots[1]?.apiKeyEnv).toBe('RESEARCH_LLM_AGENT_API_KEY_2')
		})

		it('should take a model named for that slot alone', async () => {
			// GIVEN a second choice with its own model
			const slots = slotsOf(
				await read({
					...AGENT_ON_GROQ,
					RESEARCH_LLM_AGENT_PROVIDERS: 'groq,groq',
					RESEARCH_LLM_AGENT_MODEL_2: 'openai/gpt-oss-20b',
				}),
			)

			// WHEN read — THEN each slot keeps its own, since a vendor that falls
			// back to a different model is the ordinary case
			expect(slots.map(s => s.model)).toEqual([
				'openai/gpt-oss-120b',
				'openai/gpt-oss-20b',
			])
		})
	})

	describe('when a second choice is on a vendor with no address of its own', () => {
		it('should refuse to answer until that address is given', async () => {
			// GIVEN a second choice on `custom`, whose address is never assumed
			const reason = reasonOf(
				await read({
					...AGENT_ON_GROQ,
					RESEARCH_LLM_AGENT_PROVIDERS: 'groq,custom',
				}),
			)

			// WHEN read — THEN it says which setting is missing, rather than quietly
			// leaving out a slot a run would try to use the moment the first faltered
			expect(reason).toContain('RESEARCH_LLM_AGENT_BASE_URL_2')
		})
	})

	describe('when a tier reaches no vendor at all', () => {
		it('should list nothing for it', async () => {
			// GIVEN every tier stubbed, and none of them given a model
			const exit = await read({
				RESEARCH_LLM_AGENT_PROVIDERS: 'stub',
				RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
				RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
			})

			// WHEN read — THEN there is nothing to ask, because a stubbed tier
			// answers from canned data and reaches no vendor. It must not ask for a
			// model on the way to working that out: nobody gives a stubbed tier one,
			// so asking turns "this is stubbed" into a missing-setting failure.
			expect(reasonOf(exit)).toBe('')
			expect(slotsOf(exit)).toEqual([])
		})

		it('should say so even when a live vendor sits behind the stub', async () => {
			// GIVEN a tier whose first choice is the stub and second is a real vendor
			const slots = slotsOf(
				await read({
					...AGENT_ON_GROQ,
					RESEARCH_LLM_AGENT_PROVIDERS: 'stub,groq',
				}),
			)

			// WHEN read — THEN the tier lists nothing, because the layer that builds
			// it swaps the whole tier for canned answers on the first choice alone and
			// never reaches the second
			expect(slots).toEqual([])
		})
	})
})

describe('which vendor a tier would really answer with', () => {
	const readTiers = (
		env: Record<string, string>,
		only?: ReadonlyArray<LlmTier>,
	) =>
		Effect.runPromise(
			resolvedTierVendors(only).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	describe('when a tier names a real vendor', () => {
		it('should name that vendor', async () => {
			// GIVEN one live tier and two stubbed
			const tiers = await readTiers(AGENT_ON_GROQ)

			// WHEN read — THEN each tier reports what would answer for it
			expect(tiers).toEqual([
				{ tier: 'agent', vendor: 'groq' },
				{ tier: 'extract', vendor: 'stub' },
				{ tier: 'writer', vendor: 'stub' },
			])
		})
	})

	describe('when the caller asks about no tier at all', () => {
		it('should read no settings rather than demanding all of them', async () => {
			// GIVEN an environment that says nothing about any model tier, which is
			// what a run that only discovers contacts needs — it reaches no model
			const tiers = await readTiers({}, [])

			// WHEN nothing is asked about — THEN nothing is read, so a caller that
			// touches no tier is not stopped for want of settings behind all three
			expect(tiers).toEqual([])
		})
	})

	describe('when a tier puts a real vendor behind the stub', () => {
		it('should still report the stub', async () => {
			// GIVEN a tier reading `stub,groq`
			const tiers = await readTiers({
				...AGENT_ON_GROQ,
				RESEARCH_LLM_AGENT_PROVIDERS: 'stub,groq',
			})

			// WHEN read — THEN it reports the stub, because the first choice is what a
			// call reaches; a list that merely mentions a real vendor runs on canned
			// answers all the same
			expect(tiers[0]).toEqual({ tier: 'agent', vendor: 'stub' })
		})
	})
})

describe('what silence in a tier’s settings means to each reader', () => {
	const readIfSet = (env: Record<string, string>, tier: LlmTier) =>
		Effect.runPromiseExit(
			configuredSlotsIfSet(tier).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
			),
		)

	describe('when a check needs the models a run uses', () => {
		it('should stop and name the setting, since a tier a run needs is a fault', async () => {
			// GIVEN the writer tier left unset while the other two are configured
			const exit = await read({
				RESEARCH_LLM_AGENT_PROVIDERS: 'stub',
				RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
			})

			// WHEN read through the strict reader — THEN it says which setting is
			// missing, so a check that calls the models cannot go quiet on a machine
			// whose settings somebody half-wrote
			expect(reasonOf(exit)).toContain('RESEARCH_LLM_WRITER_PROVIDERS')
		})
	})

	describe('when a check only reports on what is configured', () => {
		it('should come back empty rather than stopping', async () => {
			// GIVEN nothing said about the writer tier
			const exit = await readIfSet({}, 'writer')

			// WHEN read through the reporting reader — THEN silence means the tier
			// reaches no vendor, so a tier nobody set cannot hide the tiers beside it
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) expect(exit.value).toEqual([])
		})

		it('should still stop when the setting was written and will not read', async () => {
			// GIVEN a mistyped vendor name — the setting exists and is wrong
			const exit = await readIfSet(
				{ RESEARCH_LLM_AGENT_PROVIDERS: 'grok' },
				'agent',
			)

			// WHEN read — THEN a typo is a fault rather than silence, which is what
			// keeps "you never set this" apart from "what you set is wrong"
			expect(reasonOf(exit)).toContain('RESEARCH_LLM_AGENT_PROVIDERS')
		})

		it('should list the models when the tier is set', async () => {
			// GIVEN a tier on a real vendor
			const exit = await readIfSet(AGENT_ON_GROQ, 'agent')

			// WHEN read — THEN it answers with the same slots the strict reader gives
			expect(Exit.isSuccess(exit)).toBe(true)
			if (Exit.isSuccess(exit)) expect(exit.value).toHaveLength(1)
		})
	})
})
