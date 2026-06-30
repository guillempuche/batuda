import { Effect, Schema } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	type Agent,
	type ResolvedInstructions,
	type ResolveRefsResult,
	resolveInstructionRefs,
	resolveInstructions,
} from '@batuda/instructions'

// Per-run instruction-override surface for the agent-facing research MCP tools.
// A caller names instruction templates by human name OR id; names resolve
// server-side, scoped by RLS to the org's templates plus the caller's own. An
// unresolved name returns a clarification the tool hands straight back instead of
// acting, so the AI re-asks the human or retries with the exact id.

// The override param: an array of template names or ids.
export const InstructionsOverride = Schema.Array(Schema.String)

const InstructionCandidate = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	scope: Schema.Literals(['personal', 'org']),
})

// Returned in place of the normal result when a name can't be resolved. Shared
// across tools so every surface reports collisions the same way.
export const InstructionClarification = Schema.Struct({
	_tag: Schema.Literal('instruction_clarification'),
	message: Schema.String,
	unknown: Schema.Array(Schema.String),
	ambiguous: Schema.Array(
		Schema.Struct({
			query: Schema.String,
			candidates: Schema.Array(InstructionCandidate),
		}),
	),
})

export const buildClarification = (
	result: Extract<ResolveRefsResult, { readonly ok: false }>,
) => ({
	_tag: 'instruction_clarification' as const,
	message:
		'One or more instruction references could not be resolved, so nothing was done. For an unknown name, fix the spelling or create the template first; for an ambiguous name, pass the exact id from the listed candidates.',
	unknown: result.unknown,
	ambiguous: result.ambiguous,
})

export type OverrideResolution =
	| { readonly ok: true; readonly instructions: ResolvedInstructions }
	| {
			readonly ok: false
			readonly clarification: ReturnType<typeof buildClarification>
	  }

// Resolve a caller's override (names or ids) and then the effective instruction
// stack for one agent run. Both reads go through RLS, so this must run inside the
// request transaction (the captured `sql` is the request-scoped client). Returns
// the resolved instructions, or a clarification to hand back when a name doesn't
// resolve — in which case no stack is resolved and the caller should not act.
export const resolveInstructionOverride = (args: {
	readonly sql: SqlClient.SqlClient
	readonly organizationId: string
	readonly userId: string
	readonly agent: Agent
	readonly refs: ReadonlyArray<string>
}): Effect.Effect<OverrideResolution, SqlError.SqlError> =>
	Effect.gen(function* () {
		const refResult = yield* resolveInstructionRefs(args.refs).pipe(
			Effect.provideService(SqlClient.SqlClient, args.sql),
		)
		if (!refResult.ok) {
			return {
				ok: false as const,
				clarification: buildClarification(refResult),
			}
		}
		const instructions = yield* resolveInstructions({
			organizationId: args.organizationId,
			userId: args.userId,
			agent: args.agent,
			overrideTemplateIds: refResult.templateIds,
		}).pipe(Effect.provideService(SqlClient.SqlClient, args.sql))
		return { ok: true as const, instructions }
	})
