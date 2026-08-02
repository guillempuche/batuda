import { Effect, Layer } from 'effect'
import { McpSchema } from 'effect/unstable/ai'
import { describe, expect, it } from 'vitest'

import { canElicit } from './_elicit'

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
