import { McpProtocol } from 'effect/ai'

// Newest first: a client that names a version not listed here gets the first
// entry. 2025-06-18 is the newest our clients' approval prompts (elicitation)
// have been tested against; 2026-07-28 is stateless and can't ask at all.
export const MCP_PROTOCOLS = [
	McpProtocol.v2025_06_18,
	McpProtocol.v2025_03_26,
	McpProtocol.v2024_11_05,
] as const
