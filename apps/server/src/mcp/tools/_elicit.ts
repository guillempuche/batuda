import { Effect } from 'effect'
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
