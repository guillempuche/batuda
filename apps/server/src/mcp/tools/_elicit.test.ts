import { Effect, Fiber, Layer } from 'effect'
import { McpSchema } from 'effect/ai'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { CurrentOrg } from '@batuda/controllers'

import { CurrentUser } from '../current-user'
import { canElicit, requireApproval } from './_elicit'

// A client on the other end of the connection, described the way it described
// itself when it opened one. Only the capabilities matter here, so the rest of
// the connection is left unbuilt.
const clientSaying = (capabilities: Record<string, unknown>) =>
	Layer.mergeAll(
		Layer.succeed(McpSchema.McpServerClient, {
			clientId: 1,
			initializePayload: { capabilities },
			getClient: Effect.die('the test never talks back to the client'),
		} as never),
		Layer.succeed(McpSchema.McpRequestContext, {
			clientId: 1,
			protocolVersion: '2025-11-25',
			clientCapabilities: capabilities,
		}),
	)

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

// A client that can be asked, and answers the way the argument says — or fails
// to put the question at all. Only the one call a question makes is built;
// anything else is a bug in the test.
const clientAnswering = (
	answer:
		| { action: 'accept'; content: unknown }
		| { action: 'decline' }
		| { action: 'cancel' }
		| 'fails',
) =>
	Layer.mergeAll(
		Layer.succeed(McpSchema.McpServerClient, {
			clientId: 1,
			initializePayload: { capabilities: { elicitation: {} } },
			getClient: Effect.succeed({
				elicit: () =>
					answer === 'fails'
						? Effect.fail(new Error('the client could not show the question'))
						: Effect.succeed(answer),
			}),
		} as never),
		Layer.succeed(McpSchema.McpRequestContext, {
			clientId: 1,
			protocolVersion: '2025-11-25',
			clientCapabilities: { elicitation: {} },
		}),
	)

const askFor = (
	layer: Layer.Layer<McpSchema.McpServerClient | McpSchema.McpRequestContext>,
) =>
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
					clientAnswering({ action: 'accept', content: { confirm: true } }),
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
					clientAnswering({ action: 'accept', content: { confirm: false } }),
				),
			).toBe('declined')
		})

		it('should take turning the question down as a no', async () => {
			// GIVEN a client whose person refused the question outright
			// WHEN approval is asked for
			// THEN it is the same decision as answering no
			expect(await askFor(clientAnswering({ action: 'decline' }))).toBe(
				'declined',
			)
		})

		it('should treat closing the question without choosing as a no', async () => {
			// GIVEN a client whose person dismissed the question, which the library
			// reports by interrupting the call
			// WHEN approval is asked for
			// THEN nothing was agreed to, so nothing may happen — and it is the
			// person's doing, not a server fault for the assistant to retry
			expect(await askFor(clientAnswering({ action: 'cancel' }))).toBe(
				'declined',
			)
		})
	})

	describe('when the client answers with something that is not a true or false', () => {
		it('should not treat it as an agreement, nor fail the call', async () => {
			// GIVEN a client that accepted the question but sent a word instead of a
			// true/false
			// WHEN approval is asked for
			// THEN nobody decided anything readable, so the caller is pointed
			// elsewhere rather than cleared to act or handed an internal error
			expect(
				await askFor(
					clientAnswering({ action: 'accept', content: { confirm: 'true' } }),
				),
			).toBe('unaskable')
		})
	})

	describe('when the client fails to put the question', () => {
		it('should say there was nobody to ask, not that somebody said no', async () => {
			// GIVEN a client that claimed it could ask, then answered the question
			// with an error instead of showing it
			// WHEN approval is asked for
			// THEN nobody decided anything, so the caller is told to look elsewhere
			// rather than that the answer was no
			expect(await askFor(clientAnswering('fails'))).toBe('unaskable')
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

describe('requireApproval when nobody answers', () => {
	it('should stop waiting and say nobody answered, rather than hold on forever', async () => {
		// GIVEN a client that can be asked but whose person never replies
		const silent = Layer.mergeAll(
			Layer.succeed(McpSchema.McpServerClient, {
				clientId: 1,
				initializePayload: { capabilities: { elicitation: {} } },
				getClient: Effect.succeed({ elicit: () => Effect.never }),
			} as never),
			Layer.succeed(McpSchema.McpRequestContext, {
				clientId: 1,
				protocolVersion: '2025-11-25',
				clientCapabilities: { elicitation: {} },
			}),
		)

		// WHEN approval is asked for and the clock runs past the wait
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const asking = yield* Effect.forkChild(
					requireApproval('Do the thing?').pipe(Effect.provide(silent)),
				)
				yield* Effect.yieldNow
				yield* TestClock.adjust('5 minutes')
				return yield* Fiber.join(asking)
			}).pipe(Effect.provide(TestClock.layer())),
		)

		// THEN the answer is that nobody answered — not a no, and not a client
		// that could not ask — so the tool can say which it was
		expect(answer).toBe('unanswered')
	})
})

// A client that can be asked, signed in as `userId` in `orgId`, whose person
// never answers.
const silentClientFor = (userId: string, orgId = `org-of-${userId}`) =>
	Layer.mergeAll(
		Layer.succeed(CurrentOrg, {
			id: orgId,
			name: orgId,
			slug: orgId,
			role: 'member',
		} as never),
		Layer.succeed(CurrentUser, {
			userId,
			email: `${userId}@example.com`,
			name: userId,
			isAgent: true,
		}),
		Layer.succeed(McpSchema.McpServerClient, {
			clientId: 1,
			initializePayload: { capabilities: { elicitation: {} } },
			getClient: Effect.succeed({ elicit: () => Effect.never }),
		} as never),
		Layer.succeed(McpSchema.McpRequestContext, {
			clientId: 1,
			protocolVersion: '2025-11-25',
			clientCapabilities: { elicitation: {} },
		}),
	)

const waitFor = (userId: string, orgId?: string) =>
	requireApproval('Do the thing?').pipe(
		Effect.provide(silentClientFor(userId, orgId)),
	)

describe('requireApproval with questions already waiting', () => {
	it('should not put a second question to a caller who has one waiting', async () => {
		// GIVEN a caller whose earlier question is still waiting
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* Effect.forkChild(waitFor('ada'))
				yield* Effect.yieldNow

				// WHEN the same caller asks again
				const second = yield* waitFor('ada')
				yield* Fiber.interrupt(first)
				return second
			}),
		)

		// THEN the second is not put — each waiting question keeps a database
		// connection — and the tool is told another question is waiting, so it
		// can ask again once that one is answered
		expect(answer).toBe('busy')
	})

	it('should not put a fourth question while three are waiting across the server', async () => {
		// GIVEN three callers each with a question waiting
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const waiting = yield* Effect.forEach(['ada', 'bo', 'cy'], user =>
					Effect.forkChild(waitFor(user)),
				)
				yield* Effect.yieldNow

				// WHEN a fourth caller asks
				const fourth = yield* waitFor('di')
				yield* Effect.forEach(waiting, Fiber.interrupt)
				return fourth
			}),
		)

		// THEN it is not put, which keeps most of the connections free for the
		// requests that answer those questions and for everything else
		expect(answer).toBe('busy')
	})

	it('should keep a seat for other organizations when one has two waiting', async () => {
		// GIVEN two people of one organization each with a question waiting
		const answers = await Effect.runPromise(
			Effect.gen(function* () {
				const waiting = yield* Effect.forEach(['ada', 'bo'], user =>
					Effect.forkChild(waitFor(user, 'acme')),
				)
				yield* Effect.yieldNow

				// WHEN a third person of that organization asks, and then somebody
				// from another organization
				const sameOrg = yield* waitFor('cy', 'acme')
				const otherOrg = yield* Effect.forkChild(waitFor('di', 'globex'))
				yield* Effect.yieldNow
				// Still running means it was put and is waiting for its answer; a
				// question turned away would already have finished with 'busy'.
				const otherWasAsked = otherOrg.pollUnsafe() === undefined
				yield* Effect.forEach([...waiting, otherOrg], Fiber.interrupt)
				return { sameOrg, otherWasAsked }
			}),
		)

		// THEN the third person of the busy organization waits their turn, and
		// the other organization's question is put — one organization cannot
		// keep everyone else's questions from being asked
		expect(answers.sameOrg).toBe('busy')
		expect(answers.otherWasAsked).toBe(true)
	})

	it('should put a question again once the waiting ones are gone', async () => {
		// GIVEN three questions that waited and were then given up
		await Effect.runPromise(
			Effect.gen(function* () {
				const waiting = yield* Effect.forEach(['ada', 'bo', 'cy'], user =>
					Effect.forkChild(waitFor(user)),
				)
				yield* Effect.yieldNow
				yield* Effect.forEach(waiting, Fiber.interrupt)
			}),
		)

		// WHEN somebody asks afterwards
		// THEN the question is put and answered as usual — no seat was kept
		expect(
			await askFor(
				clientAnswering({ action: 'accept', content: { confirm: true } }),
			),
		).toBe('confirmed')
	})
})
