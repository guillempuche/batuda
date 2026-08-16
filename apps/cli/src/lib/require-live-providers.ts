/**
 * Refuse to start a measuring run whose answers would come from canned data.
 *
 * The research pipeline can be pointed at a stub for any of its parts, which is what
 * lets the rest of Batuda be developed with no keys at all. For an eval that setting is
 * poison: the stub answers, the run succeeds, and a pass spends hours reporting numbers
 * about made-up companies. The failure looks exactly like a real bad result — an empty
 * rate of 100% — so the usual way to discover it is to read the whole pass and work
 * back.
 *
 * Only a stub is refused. A part set to `none` is switched off and returns nothing,
 * which is a deliberate setting somebody chose — the eval's own notes ask for the
 * company registers to be off for a quality pass — and it shows up honestly in the
 * result rather than dressing invention up as a finding. A part nobody set at all
 * either has a default of `none` or already stops the boot naming itself, so neither
 * needs saying here.
 *
 * What each command has to reach is stated where the command is, because it differs:
 * contact discovery never searches or scrapes, so demanding those of it would refuse a
 * setup that was correct.
 */

import { type Config, Data, Effect } from 'effect'

import {
	type LlmTier,
	type ResearchCapability,
	resolvedCapabilityVendors,
	resolvedTierVendors,
} from '@batuda/research'

/** What a command has to reach for its numbers to mean anything. */
export interface RequiredRouting {
	readonly tiers: ReadonlyArray<LlmTier>
	readonly capabilities: ReadonlyArray<ResearchCapability>
}

export class StubbedProvidersRefused extends Data.TaggedError(
	'StubbedProvidersRefused',
)<{
	readonly command: string
	readonly stubbed: ReadonlyArray<string>
}> {
	// The TUI prints `error.message` directly, so the reason has to live here.
	override get message(): string {
		return [
			`Refused to run \`${this.command}\`: ${this.stubbed.join(' and ')} would answer with canned data.`,
			'A pass would finish clean and report numbers about companies that do not exist.',
			'Point them at a real vendor, or use a command that does not need them.',
		].join(' ')
	}
}

const TIER_LABELS: Record<LlmTier, string> = {
	agent: 'the agent model tier',
	extract: 'the extract model tier',
	writer: 'the writer model tier',
}

/**
 * Stop before spending anything when a part this command measures through would hand
 * back canned data.
 *
 * Read through whatever settings the caller has in scope, so a command that overrides a
 * provider for the run is judged on the value it will actually use rather than on what
 * the environment happens to say.
 */
export const requireLiveProviders = (
	command: string,
	needs: RequiredRouting,
): Effect.Effect<void, StubbedProvidersRefused | Config.ConfigError> =>
	Effect.gen(function* () {
		// Ask only about the parts this command goes through. Reading the others
		// would fail a correct setup for want of a setting behind something it never
		// touches — search and scrape have no default, and a command that hands
		// discovery a domain never reaches either.
		const [tiers, capabilities] = yield* Effect.all([
			resolvedTierVendors(needs.tiers),
			resolvedCapabilityVendors(needs.capabilities),
		])
		const stubbed = [
			...tiers
				.filter(entry => entry.vendor === 'stub')
				.map(entry => TIER_LABELS[entry.tier]),
			...capabilities
				.filter(entry => entry.vendor === 'stub')
				.map(entry => entry.capability),
		]
		if (stubbed.length === 0) return
		return yield* Effect.fail(new StubbedProvidersRefused({ command, stubbed }))
	})
