// A failure whose wording was written for the assistant to read and act on —
// "draft_id is required to update a draft", "that mailbox belongs to someone
// else", "no document with that id". Everything else a tool fails with gets a
// fixed, uninformative sentence instead, because a raw fault carries database
// text, table names and internal paths.
//
// The distinction has to be marked where the failure is raised: further out, a
// message written for a person and a message leaked from Postgres look alike.

const ToolMessageTypeId = Symbol.for('batuda/mcp/ToolMessage')

export class ToolMessage extends Error {
	readonly [ToolMessageTypeId] = true
	constructor(message: string) {
		super(message)
		this.name = 'ToolMessage'
	}
}

// Marked failures survive being carried across a module boundary or a bundle
// split, where `instanceof` against a re-imported class does not.
export const isToolMessage = (value: unknown): value is ToolMessage =>
	typeof value === 'object' && value !== null && ToolMessageTypeId in value
