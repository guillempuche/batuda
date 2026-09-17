import { describe, expect, it } from 'vitest'

import { ProviderError, RejectedToolCall } from '../domain/errors'
import {
	correctionForFailedRound,
	rejectedToolCallCorrection,
} from './tool-call-correction'
import { researchToolkit, toolParametersWireFormat } from './tools'

// ── Test helpers ──

// What the provider objected to, in the words it used on the run that prompted
// all this: three arguments left out and two invented.
const REFUSAL =
	"missing properties: 'limit', 'recency_days', 'country', additionalProperties 'topn', 'source' not allowed"

interface WireSchema {
	readonly properties?: Record<string, { readonly description?: string }>
	readonly required?: ReadonlyArray<string>
}

const schemaOf = (toolName: string): WireSchema =>
	toolParametersWireFormat(toolName) as WireSchema

describe('rejectedToolCallCorrection', () => {
	describe('when the model wrote a tool call the tool would not take', () => {
		it('should name the tool, the mistake and every argument the tool accepts', () => {
			// GIVEN the refusal a provider sent for a bad web_search call
			// WHEN a correction is built for it
			const correction = rejectedToolCallCorrection('web_search', REFUSAL)

			// THEN it names the tool and repeats what was objected to, so the model
			// is told what it got wrong rather than simply asked again
			expect(correction).toContain('web_search')
			expect(correction).toContain(REFUSAL)

			// AND it lists every argument the live schema declares — a correction
			// that named only some of them would send the model back to fail again
			for (const name of Object.keys(schemaOf('web_search').properties ?? {})) {
				expect(correction).toContain(name)
			}
		})

		it("should carry each argument's own words, not just its name and type", () => {
			// GIVEN a refusal naming registry_lookup, whose country argument takes a
			// two-letter code and nothing else
			// WHEN a correction is built for it
			const correction = rejectedToolCallCorrection('registry_lookup', REFUSAL)

			// THEN the schema's own description of each argument travels with it. A
			// bare "country (string)" reads as though any string would do, which is
			// exactly what a model that wrote "Spain" already believes
			for (const [name, parameter] of Object.entries(
				schemaOf('registry_lookup').properties ?? {},
			)) {
				if (parameter.description === undefined) continue
				expect(correction).toContain(`${name} (`)
				expect(correction).toContain(parameter.description)
			}
		})

		it('should spell out both rules a refused call breaks', () => {
			// GIVEN the same refusal
			// WHEN a correction is built for it
			const correction = rejectedToolCallCorrection('web_search', REFUSAL)

			// THEN it says every argument must be present — the half the missing
			// properties broke
			expect(correction).toContain('every one of them must be present')

			// AND it says no other argument name is allowed — the half `topn` and
			// `source` broke, which no amount of optionality would have fixed
			expect(correction).toContain('Send no argument that is not on that list.')
		})

		it("should carry each argument's accepted types", () => {
			// GIVEN a refusal naming web_search, whose numeric arguments also take
			// the number written as text
			// WHEN a correction is built for it
			const correction = rejectedToolCallCorrection('web_search', REFUSAL)

			// THEN the types travel with the names, so a model that quoted a digit
			// can see that quoting one is allowed
			expect(correction).toContain('number or string or null')
			expect(correction).toContain('query (string)')
		})
	})

	describe('when the tool has an argument that accepts null', () => {
		it('should tell the model to send null rather than leave it out', () => {
			// GIVEN web_search, three of whose four arguments take null
			// WHEN a correction is built for it
			const correction = rejectedToolCallCorrection('web_search', REFUSAL)

			// THEN the model is told how to say "no value" for those, which is the
			// whole reason the arguments are written as taking null
			expect(correction).toContain('Where an argument accepts null')
		})
	})

	describe('when every argument of the tool demands a real value', () => {
		it('should not invite the model to send null', () => {
			// GIVEN scrape_page, whose only argument is a url that cannot be null
			// WHEN a correction is built for it
			const correction = rejectedToolCallCorrection('scrape_page', REFUSAL)

			// THEN nothing suggests sending null: a model that took that advice
			// would write `url: null` and have the call refused all over again
			expect(correction).not.toContain('null')
		})
	})

	describe('when it tells the model every argument must be present', () => {
		it('should be saying what the live schema says, for every tool', () => {
			for (const tool of Object.values(researchToolkit.tools)) {
				// GIVEN a tool as the provider is really sent it
				// WHEN its declared arguments are set beside its required ones
				const schema = schemaOf(tool.name)

				// THEN the arguments it declares and the ones it requires are the same
				// list, which is what lets the correction say so flatly rather than
				// work out which are which. A tool that ever declared a genuinely
				// optional argument would fail here instead of quietly having the
				// model told the wrong thing.
				expect([...(schema.required ?? [])].sort()).toEqual(
					Object.keys(schema.properties ?? {}).sort(),
				)
			}
		})
	})

	describe('when the refusal names a tool the toolkit does not hold', () => {
		it('should offer no correction rather than invent one', () => {
			// GIVEN a refusal naming a tool we do not have — what the provider sends
			// when its message could not be read, where the tool reads "unknown"
			// WHEN a correction is asked for
			const correction = rejectedToolCallCorrection('unknown', REFUSAL)

			// THEN there is none: nothing truthful can be said about the arguments
			// of a tool that cannot be looked up, and the failure should stand
			expect(correction).toBeUndefined()
		})
	})
})

describe('correctionForFailedRound', () => {
	// What reaches the run fiber when a model wrote a call no vendor would take:
	// every retry on every slot already spent on the same bad call.
	const rejected = (toolName: string) =>
		new RejectedToolCall(
			{
				provider: 'groq',
				message: `Invalid parameters for tool '${toolName}'`,
			},
			toolName,
			REFUSAL,
		)

	describe('when the model wrote a tool call the tool would not take', () => {
		it('should offer a correction naming the tool and the vendor that refused it', () => {
			// GIVEN a refused web_search call and corrections still to spend
			// WHEN the run fiber asks whether there is anything to say
			const correction = correctionForFailedRound(rejected('web_search'), 0, 2)

			// THEN it gets the words to append and the two facts the log line needs
			expect(correction?.toolName).toBe('web_search')
			expect(correction?.provider).toBe('groq')
			expect(correction?.text).toContain('web_search takes exactly these')
		})
	})

	describe('when the pass has spent its corrections', () => {
		it('should offer none, so the failure ends the run', () => {
			// GIVEN a refused call, with as many corrections already made as allowed
			// WHEN the run fiber asks
			// THEN there is nothing to say: a model that could not write the call
			// right in two goes will not on a third, and each go has already cost a
			// full round of retries on every vendor slot
			expect(
				correctionForFailedRound(rejected('web_search'), 2, 2),
			).toBeUndefined()
		})
	})

	describe('when the failure is not the model fumbling a tool call', () => {
		it('should offer none rather than correct an unrelated failure', () => {
			// GIVEN a vendor that was simply down
			const outage = new ProviderError({
				provider: 'groq',
				message: 'groq request timed out after 1m',
				recoverable: true,
			})

			// WHEN the run fiber asks
			// THEN nothing — telling a model about its arguments would not fix a
			// vendor being down, and swallowing the failure would ship a transcript
			// built from rounds that never ran
			expect(correctionForFailedRound(outage, 0, 2)).toBeUndefined()
		})
	})

	describe('when the refusal named a tool that cannot be looked up', () => {
		it('should offer none rather than invent one', () => {
			// GIVEN a refusal whose wording could not be read, which leaves the tool
			// recorded as "unknown"
			// WHEN the run fiber asks
			// THEN nothing truthful can be said, so the failure stands
			expect(
				correctionForFailedRound(rejected('unknown'), 0, 2),
			).toBeUndefined()
		})
	})
})
