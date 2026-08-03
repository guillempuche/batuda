import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export const seedReset = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.logInfo('Truncating CRM tables...')
	// DELETE rather than TRUNCATE CASCADE: threads and messages point at
	// mailboxes, and cascading would take the history with them.
	yield* sql`DELETE FROM inboxes`
	// Removals go too: they outlive the choice they sit on, so one left behind
	// would keep cutting a freshly seeded connection off from an organization.
	yield* sql`DELETE FROM mcp_oauth_revocation WHERE client_id LIKE 'mock-%'`
	yield* sql`DELETE FROM mcp_oauth_org_membership WHERE client_id LIKE 'mock-%'`
	yield* sql`DELETE FROM "oauthConsent" WHERE "clientId" LIKE 'mock-%'`
	yield* sql`DELETE FROM "oauthClient" WHERE "clientId" LIKE 'mock-%'`
	// `channels` is named here rather than left to the cascade. It says what it
	// belongs to by table and id, so it holds no foreign key pointing at a
	// company or a person — and a table nothing points at is a table nothing
	// clears. Left out, every address on file would survive a reset and attach
	// itself to whatever new row happened to be given the same id.
	yield* sql`TRUNCATE companies, company_industries, channels, products, pages, research_runs, sources, user_research_policy, organization_research_policy, email_thread_links, email_messages, call_recordings, instruction_templates, instruction_stacks, instruction_stack_items CASCADE`
})
