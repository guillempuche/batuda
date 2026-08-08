import { Effect, Layer } from 'effect'
import { McpSchema } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { canElicit, requireApproval } from './_elicit'

// A client on the other end of the connection, described the way it described
// itself when it opened one. Only the capabilities matter here, so the rest of
// the connection is left unbuilt.
const clientSaying = (capabilities: Record<string, unknown>) =>
	Layer.succeed(McpSchema.McpServerClient, {
		clientId: 1,
		initializePayload: { capabilities },
		getClient: Effect.die('the test never talks back to the client'),
	} as never)

const ask = (capabilities: Record<string, unknown>) =>
	Effect.runPromise(canElicit.pipe(Effect.provide(clientSaying(capabilities))))

describe('canElicit', () => {
	describe('when the client says it can put a question to somebody', () => {
		it('should say there is somebody to ask', async () => {
			// GIVEN a client that named the capability when it connected — an
			// empty object is how it is named, so its presence is the whole signal
			// WHEN asking whether a question can be put
			// THEN it can
			expect(await ask({ elicitation: {} })).toBe(true)
		})

		it('should say so whatever else the client can do', async () => {
			// GIVEN a client that named it alongside its other capabilities
			// WHEN asking whether a question can be put
			// THEN the others make no difference
			expect(
				await ask({
					elicitation: {},
					sampling: {},
					roots: { listChanged: true },
				}),
			).toBe(true)
		})
	})

	describe('when the client never named it', () => {
		it('should say there is nobody to ask', async () => {
			// GIVEN a client that listed other capabilities but not this one —
			// which is what both of the clients people actually use do
			// WHEN asking whether a question can be put
			// THEN it cannot, so a tool can say that rather than reporting a
			// refusal nobody gave
			expect(await ask({ sampling: {} })).toBe(false)
		})

		it('should say the same when it named nothing at all', async () => {
			// GIVEN a client that opened with an empty list of capabilities
			// WHEN asking whether a question can be put
			// THEN it cannot
			expect(await ask({})).toBe(false)
		})
	})
})

// A client that can be asked, and answers the way the argument says. Only the
// one call a question makes is built; anything else is a bug in the test.
const clientAnswering = (
	answer: { action: 'accept'; content: unknown } | { action: 'decline' },
) =>
	Layer.succeed(McpSchema.McpServerClient, {
		clientId: 1,
		initializePayload: { capabilities: { elicitation: {} } },
		getClient: Effect.succeed({
			'elicitation/create': () => Effect.succeed(answer),
		}),
	} as never)

const askFor = (layer: Layer.Layer<McpSchema.McpServerClient>) =>
	Effect.runPromise(
		requireApproval('Do the thing?').pipe(Effect.provide(layer)),
	)

describe('requireApproval', () => {
	describe('when somebody is asked and agrees', () => {
		it('should report that they confirmed it', async () => {
			// GIVEN a client that can put the question, whose person answers yes
			// WHEN approval is asked for
			// THEN the caller is cleared to act
			expect(
				await askFor(
					clientAnswering({ action: 'accept', content: { confirm: 'yes' } }),
				),
			).toBe('confirmed')
		})
	})

	describe('when somebody is asked and says no', () => {
		it('should report a decision, not a missing one', async () => {
			// GIVEN the same client, whose person answers no
			// WHEN approval is asked for
			// THEN it is a decision — the caller must not retry or route around it
			expect(
				await askFor(
					clientAnswering({ action: 'accept', content: { confirm: 'no' } }),
				),
			).toBe('declined')
		})

		it('should treat dismissing the question as a no', async () => {
			// GIVEN a client whose person closed the question without answering
			// WHEN approval is asked for
			// THEN nothing was agreed to, so nothing may happen
			expect(await askFor(clientAnswering({ action: 'decline' }))).toBe(
				'declined',
			)
		})
	})

	describe('when there is nobody to ask', () => {
		it('should say so rather than reporting a refusal nobody gave', async () => {
			// GIVEN a client that never named the capability — which is what both
			// of the clients people actually use do
			// WHEN approval is asked for
			// THEN the caller is told there was nobody to ask, so it can point the
			// person somewhere they can decide instead of claiming they said no
			expect(await askFor(clientSaying({ sampling: {} }))).toBe('unaskable')
		})
	})
})
