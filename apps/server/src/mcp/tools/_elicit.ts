import { Cause, Duration, Effect, Option, Schema } from 'effect'
import type { McpSchema } from 'effect/ai'
import { McpServer } from 'effect/ai'

import { CurrentOrg } from '@batuda/controllers'

import { CurrentUser } from '../current-user'

// Whether there is anybody on the other end who can be asked a question.
//
// Putting a question to a client that cannot show one comes back refused, and a
// tool that reads that refusal as "the person said no" reports a decision
// nobody made. Neither Claude.ai nor ChatGPT can show one today, so every
// question asked through them answered itself with a no. Ask this first, and
// say plainly when there was nobody to ask.
export const canElicit: Effect.Effect<
	boolean,
	never,
	McpSchema.McpRequestContext
> = McpServer.clientCapabilities.pipe(
	// A client that can be asked names the capability with an empty object, so
	// its mere presence is the whole signal.
	Effect.map(capabilities => capabilities.elicitation !== undefined),
)

/**
 * What came back when a person was asked to approve something: they agreed,
 * they said no (or closed the question without choosing), there was nobody who
 * could be asked (the client cannot show a question, or answered it with
 * something unreadable), nobody answered in time, or the question was not put
 * because another is still waiting. The last three are kept apart from a no on
 * purpose — a tool that folds them together reports a refusal nobody gave, and
 * the caller can never tell whether to try elsewhere or simply ask again.
 */
export type ApprovalAnswer =
	| 'confirmed'
	| 'declined'
	| 'unaskable'
	| 'unanswered'
	| 'busy'

// How long a question waits for its answer. Nothing travels on the call's
// connection while it waits, and the proxy in front of the server (Cloudflare)
// drops a connection that has carried nothing for 125 seconds, taking the call
// and its answer with it — so the wait ends well before.
const ANSWER_WAIT = Duration.seconds(90)

// How many questions may wait for their answer at once: one per person, two per
// organization, three across the server. A call keeps its database connection
// while it waits, the pool holds ten, and the answer's own request needs one to
// sign in — so ten waiting questions would stall every request on the server.
// Two per organization always leaves a seat for the others, so one
// organization's questions cannot keep everyone else's from being put. A
// question past a limit is not put, and can be asked again once one is answered.
const MOST_WAITING = 3
const MOST_WAITING_PER_ORG = 2
let waiting = 0
const waitingPeople = new Set<string>()
const waitingByOrg = new Map<string, number>()

interface Asker {
	readonly person: string
	readonly org: string
}

const takeSeat = ({ person, org }: Asker) =>
	Effect.sync(() => {
		const inOrg = waitingByOrg.get(org) ?? 0
		if (
			waiting >= MOST_WAITING ||
			inOrg >= MOST_WAITING_PER_ORG ||
			waitingPeople.has(person)
		)
			return false
		waiting++
		waitingPeople.add(person)
		waitingByOrg.set(org, inOrg + 1)
		return true
	})

const leaveSeat = ({ person, org }: Asker) =>
	Effect.sync(() => {
		waiting--
		waitingPeople.delete(person)
		const inOrg = (waitingByOrg.get(org) ?? 1) - 1
		if (inOrg === 0) waitingByOrg.delete(org)
		else waitingByOrg.set(org, inOrg)
	})

// Who is asking, and for which organization. Every MCP call carries both; a
// caller without them (only a test does that) shares one seat with any other.
const askerOf = Effect.gen(function* () {
	const user = yield* Effect.serviceOption(CurrentUser)
	const org = yield* Effect.serviceOption(CurrentOrg)
	return {
		person: user._tag === 'Some' ? user.value.userId : 'nobody signed in',
		org: org._tag === 'Some' ? org.value.id : 'no organization',
	}
})

const ask = (message: string) =>
	McpServer.elicit({
		message,
		// A true/false answer, not a "yes"/"no" choice: the 2025-06-18 revision
		// drops a choice list on the way out, so the client shows a free-text
		// box and an answer typed as "Yes" fails the call.
		schema: Schema.Struct({ confirm: Schema.Boolean }),
	}).pipe(
		Effect.map(
			({ confirm }): ApprovalAnswer => (confirm ? 'confirmed' : 'declined'),
		),
		// A refusal carrying a cause is the client failing to put the question
		// (it answered with an error, or the question cannot be shown on this
		// revision) — nobody's no.
		Effect.catchTag('ElicitationDeclined', error =>
			Effect.succeed<ApprovalAnswer>(
				error.cause === undefined ? 'declined' : 'unaskable',
			),
		),
		// An answer that does not carry a true/false is not an agreement to act
		// on, and nothing anyone decided either.
		Effect.catchDefect(defect =>
			defect instanceof Schema.SchemaError
				? Effect.succeed<ApprovalAnswer>('unaskable')
				: Effect.die(defect),
		),
		// Closing the question without choosing comes back as an interruption.
		// It is a person turning the question down, so it reads as a no rather
		// than as a fault of the server's.
		Effect.catchCause(cause =>
			Cause.hasInterruptsOnly(cause)
				? Effect.succeed<ApprovalAnswer>('declined')
				: Effect.failCause(cause),
		),
		Effect.timeoutOption(ANSWER_WAIT),
		Effect.map(Option.getOrElse((): ApprovalAnswer => 'unanswered')),
	)

/**
 * Put a yes/no question to whoever is on the other end, before doing something
 * that spends money, writes to their records, or cannot be undone.
 *
 * Every tool that needs a person's say-so goes through here, so there is one
 * account of what "asked and agreed" means. Declaring the question on the tool
 * is not enough: the MCP surface has no field it reads for that, so a tool that
 * only declares it runs anyway. What each answer should mean for the caller —
 * what to return, what to say — belongs to the tool, not here.
 *
 * The tool must list `McpSchema.McpServerClient` and `McpSchema.McpRequestContext`
 * in its `dependencies`, or there is no client to ask.
 */
export const requireApproval = (
	message: string,
): Effect.Effect<
	ApprovalAnswer,
	never,
	McpSchema.McpServerClient | McpSchema.McpRequestContext
> =>
	Effect.gen(function* () {
		if (!(yield* canElicit)) return 'unaskable' as const
		const asker = yield* askerOf
		return yield* Effect.acquireUseRelease(
			takeSeat(asker),
			seated =>
				seated ? ask(message) : Effect.succeed<ApprovalAnswer>('busy'),
			seated => (seated ? leaveSeat(asker) : Effect.void),
		)
	})
