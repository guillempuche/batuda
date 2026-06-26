import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export const seedReset = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.logInfo('Truncating CRM tables...')
	// DELETE (not TRUNCATE CASCADE) so `member.primary_inbox_id`'s ON DELETE SET NULL fires.
	yield* sql`DELETE FROM inboxes`
	yield* sql`DELETE FROM mcp_oauth_org_membership WHERE client_id LIKE 'mock-%'`
	yield* sql`DELETE FROM "oauthConsent" WHERE "clientId" LIKE 'mock-%'`
	yield* sql`DELETE FROM "oauthClient" WHERE "clientId" LIKE 'mock-%'`
	yield* sql`TRUNCATE companies, products, pages, research_runs, sources, user_research_policy, provider_quotas, provider_usage, email_thread_links, email_messages, call_recordings, instruction_templates, agent_default_stacks, agent_default_stack_items CASCADE`
})
