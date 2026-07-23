import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Instruction stacks become named entities: each org and each member can keep
// several named stacks per agent (e.g. an 'email-formal' and an 'email-es'
// version, or a 'research-latam' market variant) and flag one as the default.
// The old model allowed exactly one stack per (org, agent) and per (org, user,
// agent); this renames those tables to drop the "default" framing, adds a name
// and an is_default flag, and reshapes uniqueness so names are unique per scope
// while at most one stack stays the default. It also removes the template
// donation table, whose review flow is retired in the same release.
//
// The renames are in place: ALTER TABLE RENAME keeps the rows, the RLS
// enablement (including FORCE), the policies, the grants, the foreign keys, and
// the indexes — only the object names carry the old table's text, so they are
// renamed too for hygiene.
//
// expand-contract: pre-production clean break — this same release rewrites every
// reader and writer (package resolver + management, service, HTTP, MCP tool,
// seeds, UI) to the new table names, columns, and the removed donation feature.
// No instance queries the old names or the donation table on the request path
// once this deploy is out.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── Retire template donations ───────────────────────────────────────────
	yield* sql`DROP TABLE IF EXISTS instruction_template_donations`

	// ── Rename the stack tables ─────────────────────────────────────────────
	yield* sql`ALTER TABLE agent_default_stacks RENAME TO instruction_stacks`
	yield* sql`ALTER TABLE agent_default_stack_items RENAME TO instruction_stack_items`

	// Policies survive the rename; only their names still read "agent_default".
	yield* sql`ALTER POLICY read_agent_default_stacks ON instruction_stacks RENAME TO read_instruction_stacks`
	yield* sql`ALTER POLICY insert_agent_default_stacks ON instruction_stacks RENAME TO insert_instruction_stacks`
	yield* sql`ALTER POLICY update_agent_default_stacks ON instruction_stacks RENAME TO update_instruction_stacks`
	yield* sql`ALTER POLICY delete_agent_default_stacks ON instruction_stacks RENAME TO delete_instruction_stacks`
	yield* sql`ALTER POLICY org_isolation_agent_default_stack_items ON instruction_stack_items RENAME TO org_isolation_instruction_stack_items`

	// Primary keys, the composition check, and the foreign keys keep their old
	// text too.
	yield* sql`ALTER TABLE instruction_stacks RENAME CONSTRAINT agent_default_stacks_pkey TO instruction_stacks_pkey`
	yield* sql`ALTER TABLE instruction_stacks RENAME CONSTRAINT agent_default_stacks_composition_valid TO instruction_stacks_composition_valid`
	yield* sql`ALTER TABLE instruction_stack_items RENAME CONSTRAINT agent_default_stack_items_pkey TO instruction_stack_items_pkey`
	yield* sql`ALTER TABLE instruction_stack_items RENAME CONSTRAINT agent_default_stack_items_stack_id_fkey TO instruction_stack_items_stack_id_fkey`
	yield* sql`ALTER TABLE instruction_stack_items RENAME CONSTRAINT agent_default_stack_items_template_id_fkey TO instruction_stack_items_template_id_fkey`

	// The item ordering/uniqueness indexes.
	yield* sql`ALTER INDEX agent_default_stack_items_position_uidx RENAME TO instruction_stack_items_position_uidx`
	yield* sql`ALTER INDEX agent_default_stack_items_template_uidx RENAME TO instruction_stack_items_template_uidx`
	yield* sql`ALTER INDEX agent_default_stack_items_template_idx RENAME TO instruction_stack_items_template_idx`

	// ── Name + default flag ─────────────────────────────────────────────────
	// Existing rows were the sole stack for their scope+agent, so each becomes a
	// stack literally named "default" and flagged as the default. The default is
	// dropped afterwards so the application must always name a stack.
	yield* sql`ALTER TABLE instruction_stacks ADD COLUMN name text NOT NULL DEFAULT 'default'`
	yield* sql`ALTER TABLE instruction_stacks ADD COLUMN is_default boolean NOT NULL DEFAULT false`
	yield* sql`UPDATE instruction_stacks SET is_default = true`
	yield* sql`ALTER TABLE instruction_stacks ALTER COLUMN name DROP DEFAULT`
	yield* sql`
		ALTER TABLE instruction_stacks
			ADD CONSTRAINT instruction_stacks_name_nonempty
			CHECK (length(btrim(name)) > 0)
	`

	// ── Reshape uniqueness ──────────────────────────────────────────────────
	// The old indexes allowed one stack per scope+agent. Replace them with: a
	// name that is unique within a scope+agent, plus at most one default per
	// scope+agent.
	yield* sql`DROP INDEX agent_default_stacks_org_default_uidx`
	yield* sql`DROP INDEX agent_default_stacks_user_default_uidx`
	yield* sql`
		CREATE UNIQUE INDEX instruction_stacks_org_name_uidx
			ON instruction_stacks (organization_id, agent, name)
			WHERE owner_user_id IS NULL
	`
	yield* sql`
		CREATE UNIQUE INDEX instruction_stacks_user_name_uidx
			ON instruction_stacks (organization_id, owner_user_id, agent, name)
			WHERE owner_user_id IS NOT NULL
	`
	yield* sql`
		CREATE UNIQUE INDEX instruction_stacks_org_default_uidx
			ON instruction_stacks (organization_id, agent)
			WHERE owner_user_id IS NULL AND is_default
	`
	yield* sql`
		CREATE UNIQUE INDEX instruction_stacks_user_default_uidx
			ON instruction_stacks (organization_id, owner_user_id, agent)
			WHERE owner_user_id IS NOT NULL AND is_default
	`
})
