import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Donating a personal instruction template to the org is admin-gated, so it
// can't be a direct ownership flip: a member proposes a donation, an admin
// accepts or rejects it. Each proposal snapshots the template's name and body
// into a donation row — that snapshot is what makes the org-isolation RLS here
// sufficient, since an admin reviewing the proposal could not otherwise read
// the proposer's still-personal template (their own policy hides it). Accepting
// creates a fresh org-owned template from the snapshot; rejecting just closes
// the proposal. The source and created templates are referenced with ON DELETE
// SET NULL so the donation record survives either being deleted later.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS instruction_template_donations (
			id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id     text NOT NULL,
			source_template_id  uuid REFERENCES instruction_templates(id) ON DELETE SET NULL,
			created_template_id uuid REFERENCES instruction_templates(id) ON DELETE SET NULL,
			name                text NOT NULL,
			body                text NOT NULL,
			proposed_by         text NOT NULL,
			status              text NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending', 'accepted', 'rejected')),
			resolved_by         text,
			created_at          timestamptz NOT NULL DEFAULT now(),
			resolved_at         timestamptz
		)
	`
	yield* sql`
		CREATE INDEX IF NOT EXISTS instruction_template_donations_org_status_idx
			ON instruction_template_donations (organization_id, status)
	`
	yield* sql`ALTER TABLE instruction_template_donations ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE instruction_template_donations FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_instruction_template_donations ON instruction_template_donations
			FOR ALL TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})
