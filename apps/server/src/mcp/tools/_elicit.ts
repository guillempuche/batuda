import { Cause, Duration, Effect, Option, Schema } from 'effect'
import type { McpSchema } from 'effect/ai'
import { McpServer } from 'effect/ai'

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
 * could be asked, or nobody answered in time. The last two are kept apart from
 * a no on purpose — a tool that folds them together reports a refusal nobody
 * gave, and the caller can never tell whether to try elsewhere.
 */
export type ApprovalAnswer =
	| 'confirmed'
	| 'declined'
	| 'unaskable'
	| 'unanswered'

// How long a question waits for its answer. Nothing travels on the call's
// connection while it waits, and the proxy in front of the server (Cloudflare)
// drops a connection that has carried nothing for 125 seconds, taking the call
// and its answer with it — so the wait ends well before.
const ANSWER_WAIT = Duration.seconds(90)

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
		const answer = yield* McpServer.elicit({
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
			// Closing the question without choosing comes back as an interruption.
			// It is a person turning the question down, so it reads as a no rather
			// than as a fault of the server's.
			Effect.catchCause(cause =>
				Cause.hasInterruptsOnly(cause)
					? Effect.succeed<ApprovalAnswer>('declined')
					: Effect.failCause(cause),
			),
			Effect.timeoutOption(ANSWER_WAIT),
		)
		return Option.getOrElse(answer, (): ApprovalAnswer => 'unanswered')
	})
