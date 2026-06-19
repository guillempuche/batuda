import { Schema } from 'effect'

// The code-defined set of AI agents that compose instruction templates into
// their prompt. Research today; email/chat/outreach later. Kept as a string
// set (not a DB enum) so adding an agent is a code change, never a migration —
// the same convention research uses for its schema_name registry.
export const agents = ['research'] as const

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

// A per-(scope, agent) ordered default stack. `ownerUserId` null = the org
// default (admin-managed); set = a user's own, which replaces the org default
// for that user.
export interface AgentDefaultStack {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly agent: Agent
}

// One ordered reference inside a stack. `position` is the add-order; the
// resolver reads a stack's items by ascending position.
export interface StackItem {
	readonly stackId: string
	readonly templateId: string
	readonly position: number
}
