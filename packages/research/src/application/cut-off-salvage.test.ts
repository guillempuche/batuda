import { Effect, Exit, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { CutOffReply, ProviderError, RESPONSE_CUT_OFF } from '../domain/errors'
import { keepWhatArrived, salvageCutOffReply } from './cut-off-salvage'

const Shape = Schema.Struct({
	enrichment: Schema.Struct({
		industry: Schema.optionalKey(Schema.Struct({ value: Schema.String })),
	}),
	contacts: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				role: Schema.optionalKey(
					Schema.Struct({ value: Schema.String, source_id: Schema.String }),
				),
			}),
		),
	),
})

const cutOff = (text: string) =>
	new CutOffReply({ provider: 'stub', message: 'reply cut off' }, text)

describe('salvageCutOffReply', () => {
	describe('when the failure carries a reply with whole values in it', () => {
		it('should keep the person the cut fell in without the field it took, and say how much was kept', async () => {
			// GIVEN a reply cut inside the second person's title, before the page
			// that title needs
			const text =
				'{"enrichment": {"industry": {"value": "logistics"}}, "contacts": [{"name": "Ana Puig", "role": {"value": "CEO", "source_id": "https://acme.es"}}, {"name": "Jordi Vila", "role": {"value": "CTO"'

			// WHEN salvaged
			const salvaged = await Effect.runPromise(
				salvageCutOffReply(cutOff(text), Shape),
			)

			// THEN the profile and both people are the value — the second without
			// the title that never got its page — and most of the text was kept
			expect(salvaged?.value).toEqual({
				enrichment: { industry: { value: 'logistics' } },
				contacts: [
					{
						name: 'Ana Puig',
						role: { value: 'CEO', source_id: 'https://acme.es' },
					},
					{ name: 'Jordi Vila' },
				],
			})
			expect(salvaged?.totalChars).toBe(text.length)
			expect(salvaged?.keptChars).toBeGreaterThan(text.length * 0.8)
			expect(salvaged?.keptChars).toBeLessThan(text.length)
		})
	})

	describe('when there is nothing whole to keep', () => {
		it('should give nothing back', async () => {
			// GIVEN a cut-off with no text behind it, one cut inside its first
			// value, one cut right after its list opened, and one whose whole part
			// does not fit the shape at any depth
			const failures = [
				new ProviderError({
					provider: 'stub',
					message: 'reply cut off',
					recoverable: false,
					reason: RESPONSE_CUT_OFF,
				}),
				cutOff('{"enrichment": {"industry": {"value": "logis'),
				cutOff('{"contacts": ['),
				cutOff('{"enrichment": {"industry": {"value": 7}}, "contacts": [{"na'),
			]

			// THEN each salvages nothing
			for (const failure of failures) {
				expect(
					await Effect.runPromise(salvageCutOffReply(failure, Shape)),
				).toBeUndefined()
			}
		})
	})
})

describe('keepWhatArrived', () => {
	describe('when part of the reply arrived whole', () => {
		it('should hand it on as the reply', async () => {
			// GIVEN a cut-off whose first person arrived whole
			const failure = cutOff(
				'{"enrichment": {}, "contacts": [{"name": "Ana Puig"}, {"na',
			)

			// WHEN kept
			const reply = await Effect.runPromise(
				keepWhatArrived(failure, Shape, 'run-1'),
			)

			// THEN the reply holds what arrived
			expect(reply.value).toEqual({
				enrichment: {},
				contacts: [{ name: 'Ana Puig' }],
			})
		})
	})

	describe('when nothing whole fits the shape', () => {
		it('should fail with the cut-off it was handed', async () => {
			// GIVEN a cut-off inside the first value
			const failure = cutOff('{"enrichment": {"industry": {"value": "lo')

			// WHEN kept
			const exit = await Effect.runPromiseExit(
				keepWhatArrived(failure, Shape, 'run-1'),
			)

			// THEN the same failure comes back
			expect(Exit.isFailure(exit)).toBe(true)
			expect(
				Exit.isFailure(exit) &&
					exit.cause.reasons.some(
						reason => 'error' in reason && reason.error === failure,
					),
			).toBe(true)
		})
	})
})
