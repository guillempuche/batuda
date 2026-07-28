import { Cause, ConfigProvider, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { type ConfiguredSlot, configuredSlots } from './llm-live'

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
// without spelling out settings for all three.
const AGENT_ON_GROQ = {
	RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
	RESEARCH_LLM_EXTRACT_MODEL: 'unused',
	RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
	RESEARCH_LLM_WRITER_MODEL: 'unused',
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
			// GIVEN every tier stubbed
			const slots = slotsOf(
				await read({
					RESEARCH_LLM_AGENT_PROVIDERS: 'stub',
					RESEARCH_LLM_AGENT_MODEL: 'unused',
					RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
					RESEARCH_LLM_EXTRACT_MODEL: 'unused',
					RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
					RESEARCH_LLM_WRITER_MODEL: 'unused',
				}),
			)

			// WHEN read — THEN there is nothing to ask, because a stubbed tier
			// answers from canned data and reaches no vendor
			expect(slots).toEqual([])
		})
	})
})
