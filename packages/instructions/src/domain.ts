import { Schema } from 'effect'

// The code-defined set of AI agents that compose instruction templates into
// their prompt. Research and email today; chat/outreach later. Kept as a string
// set (not a DB enum) so adding an agent is a code change, never a migration —
// the same convention research uses for its schema_name registry.
export const agents = ['research', 'email'] as const

export type Agent = (typeof agents)[number]

// The same closed set as an Effect Schema, so HTTP/MCP boundaries can validate
// an `agent` param with one import instead of re-deriving the literal union.
export const AgentSchema = Schema.Literals(agents)

// A named, reusable block of instruction text, owned by the org
// (`ownerUserId` null) or a user. Just text — no baked schema or hints — so the
// same template can shape any agent that stacks it.
export interface InstructionTemplate {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly name: string
	readonly body: string
	readonly createdBy: string
	readonly updatedAt: string
}

// How a personal stack combines with the org default. 'replace' uses the stack
// alone; 'extend' resolves the live org default's templates first, then the
// stack's own. Org stacks are always 'replace' (they are the base of an extend).
export type StackComposition = 'replace' | 'extend'

// A named, ordered stack of templates for one agent, owned by the org
// (`ownerUserId` null) or a member. `name` is unique within its scope+agent;
// `isDefault` marks the one stack that applies when a run names none — at most
// one per scope+agent.
export interface InstructionStack {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly agent: Agent
	readonly name: string
	readonly isDefault: boolean
	readonly composition: StackComposition
}

// One ordered reference inside a stack. `position` is the add-order; the
// resolver reads a stack's items by ascending position.
export interface StackItem {
	readonly stackId: string
	readonly templateId: string
	readonly position: number
}
