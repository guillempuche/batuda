import { Effect, Schema } from 'effect'
import type { McpSchema } from 'effect/unstable/ai'
import { McpServer } from 'effect/unstable/ai'

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
	McpSchema.McpServerClient
> = McpServer.clientCapabilities.pipe(
	// A client that can be asked names the capability with an empty object, so
	// its mere presence is the whole signal.
	Effect.map(capabilities => capabilities.elicitation !== undefined),
)

/**
 * What came back when a person was asked to approve something: they agreed,
 * they said no, or there was nobody who could be asked. The third is kept
 * apart from the second on purpose — a tool that folds them together reports a
 * refusal nobody gave, and the caller can never tell whether to try elsewhere.
 */
export type ApprovalAnswer = 'confirmed' | 'declined' | 'unaskable'

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
 * The tool must list `McpSchema.McpServerClient` in its `dependencies`, or
 * there is no client to ask.
 */
export const requireApproval = (
	message: string,
): Effect.Effect<ApprovalAnswer, never, McpSchema.McpServerClient> =>
	Effect.gen(function* () {
		if (!(yield* canElicit)) return 'unaskable' as const
		const { confirm } = yield* McpServer.elicit({
			message,
			schema: Schema.Struct({ confirm: Schema.Literals(['yes', 'no']) }),
		}).pipe(
			Effect.catchTag('ElicitationDeclined', () =>
				Effect.succeed({ confirm: 'no' as const }),
			),
		)
		return confirm === 'yes' ? 'confirmed' : 'declined'
	})
