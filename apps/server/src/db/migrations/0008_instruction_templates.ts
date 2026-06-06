import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// AI instruction templates: a surface-neutral library of named prompt blocks,
// owned by the org (owner_user_id NULL) or a user, that any agent composes into
// its system prompt — plus per-(scope, agent) default stacks, an ordered list
// of templates resolved at run time.
//
// RLS is asymmetric by design. Reads are RLS-enforced: a member sees
// org-owned templates + their own, never another member's personal ones. Writes
// are constrained only to the org at the DB level — row ownership, the admin
// gate on org-owned rows (Better-Auth member.role, which Postgres RLS can't
// read), and ownership transfer are all enforced in the application service.
// FORCE ROW LEVEL SECURITY applies the policies to the table owner too;
// app_service (BYPASSRLS) bypasses them for worker/cron paths. New tables
// inherit app_user/app_service DML grants via the ALTER DEFAULT PRIVILEGES set
// in 0001, so no GRANT statements are needed here.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// ── instruction_templates ──────────────────────────────────────────────
	// `agent`-agnostic: a template is just text and can be stacked by any agent.
	// `updated_at` feeds the resolution fingerprint; the service bumps it on
	// every body edit so an edited template never serves a stale cached run.
	yield* sql`
		CREATE TABLE IF NOT EXISTS instruction_templates (
			id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id   text NOT NULL,
			owner_user_id     text,
			name              text NOT NULL,
			body              text NOT NULL,
			source_preset_id  text,
			created_by        text NOT NULL,
			created_at        timestamptz NOT NULL DEFAULT now(),
			updated_at        timestamptz NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS instruction_templates_org_owner_idx
			ON instruction_templates (organization_id, owner_user_id)
	`
	yield* sql`ALTER TABLE instruction_templates ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE instruction_templates FORCE ROW LEVEL SECURITY`
	// Read: org-owned + own only (a member never sees another member's personal
	// templates).
	yield* sql`
		CREATE POLICY read_instruction_templates ON instruction_templates
			FOR SELECT TO app_user
			USING (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`
	// Create: own or org-owned (the org-owned case is admin-gated in the app).
	yield* sql`
		CREATE POLICY insert_instruction_templates ON instruction_templates
			FOR INSERT TO app_user
			WITH CHECK (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`
	// Update: may target own/org-owned rows; the new owner only has to stay in
	// the org, so the app can transfer ownership (donate to org, hand to another
	// member) — RLS can't model that since it can't read member.role.
	yield* sql`
		CREATE POLICY update_instruction_templates ON instruction_templates
			FOR UPDATE TO app_user
			USING (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
	// Delete: own/org-owned only (FK RESTRICT below still blocks in-use ones).
	yield* sql`
		CREATE POLICY delete_instruction_templates ON instruction_templates
			FOR DELETE TO app_user
			USING (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`

	// ── agent_default_stacks ────────────────────────────────────────────────
	// One default stack per (org, agent) and per (org, user, agent). owner NULL =
	// the org default; set = a user's own, which replaces the org default for
	// them. Stacks are not transferable (only templates are), so writes can be
	// owner-restricted on both sides.
	yield* sql`
		CREATE TABLE IF NOT EXISTS agent_default_stacks (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id  text NOT NULL,
			owner_user_id    text,
			agent            text NOT NULL,
			created_at       timestamptz NOT NULL DEFAULT now(),
			updated_at       timestamptz NOT NULL DEFAULT now()
		)
	`
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS agent_default_stacks_org_default_uidx
			ON agent_default_stacks (organization_id, agent)
			WHERE owner_user_id IS NULL
	`
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS agent_default_stacks_user_default_uidx
			ON agent_default_stacks (organization_id, owner_user_id, agent)
			WHERE owner_user_id IS NOT NULL
	`
	yield* sql`ALTER TABLE agent_default_stacks ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE agent_default_stacks FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY read_agent_default_stacks ON agent_default_stacks
			FOR SELECT TO app_user
			USING (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`
	yield* sql`
		CREATE POLICY insert_agent_default_stacks ON agent_default_stacks
			FOR INSERT TO app_user
			WITH CHECK (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`
	yield* sql`
		CREATE POLICY update_agent_default_stacks ON agent_default_stacks
			FOR UPDATE TO app_user
			USING (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
			WITH CHECK (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`
	yield* sql`
		CREATE POLICY delete_agent_default_stacks ON agent_default_stacks
			FOR DELETE TO app_user
			USING (
				organization_id = current_setting('app.current_org_id', true)
				AND (
					owner_user_id IS NULL
					OR owner_user_id = current_setting('app.current_user_id', true)
				)
			)
	`

	// ── agent_default_stack_items ──────────────────────────────────────────
	// Ordered references inside a stack. A child table (not a jsonb array) so
	// ordering stays clean and a template can't be deleted while any stack still
	// references it (FK ON DELETE RESTRICT — reassign first). organization_id is
	// denormalised for a plain org-isolation policy; the items are only orderings
	// of opaque ids, so org-wide read is acceptable (the parent stack row and the
	// template bodies stay protected by their own owner-restricted policies).
	yield* sql`
		CREATE TABLE IF NOT EXISTS agent_default_stack_items (
			id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id  text NOT NULL,
			stack_id         uuid NOT NULL REFERENCES agent_default_stacks(id) ON DELETE CASCADE,
			template_id      uuid NOT NULL REFERENCES instruction_templates(id) ON DELETE RESTRICT,
			position         int NOT NULL
		)
	`
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS agent_default_stack_items_position_uidx
			ON agent_default_stack_items (stack_id, position)
	`
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS agent_default_stack_items_template_uidx
			ON agent_default_stack_items (stack_id, template_id)
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS agent_default_stack_items_template_idx
			ON agent_default_stack_items (template_id)
	`
	yield* sql`ALTER TABLE agent_default_stack_items ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE agent_default_stack_items FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_agent_default_stack_items ON agent_default_stack_items
			FOR ALL TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})
