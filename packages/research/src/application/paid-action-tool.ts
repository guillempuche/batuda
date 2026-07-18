/**
 * The paid tools a follow-up run can actually perform when a pending paid action
 * is approved, plus the coercion that maps what the model writes onto them.
 *
 * The tool name on a pending paid action is free text the model fills in, so it
 * often names the capability rather than the tool — "email_finder" for what the
 * contact-discovery tool does, or "registry" for the registry lookup. A name
 * that matches nothing real can only be skipped, never approved, so a curated
 * set of aliases is coerced onto the real tool; anything unrecognized returns
 * null and the caller reports it as unsupported rather than acting on a name that
 * would do nothing.
 */

/** The tools a follow-up run knows how to run. */
export const PAID_FOLLOWUP_TOOLS = new Set([
	'registry_lookup',
	'discover_contacts',
])

// Names the model tends to invent for the two real tools. Kept small and
// explicit: each entry is a name seen in practice, not a guess.
const PAID_TOOL_ALIASES: Record<string, string> = {
	email_finder: 'discover_contacts',
	email_verifier: 'discover_contacts',
	contact_finder: 'discover_contacts',
	find_contacts: 'discover_contacts',
	hunter: 'discover_contacts',
	fullenrich: 'discover_contacts',
	enrichment: 'discover_contacts',
	registry: 'registry_lookup',
	registry_search: 'registry_lookup',
	company_registry: 'registry_lookup',
}

/**
 * Resolve a pending paid action's tool name to a real paid tool, or null when it
 * matches none. A canonical name passes through, a known alias is coerced, and
 * anything else returns null so the caller can reject it instead of spawning a
 * follow-up that can do nothing.
 */
export const normalizePaidActionTool = (tool: unknown): string | null => {
	if (typeof tool !== 'string') return null
	const key = tool.trim().toLowerCase()
	if (PAID_FOLLOWUP_TOOLS.has(key)) return key
	return PAID_TOOL_ALIASES[key] ?? null
}
