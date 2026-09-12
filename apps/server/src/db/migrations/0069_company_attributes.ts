import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Each campaign says which facts it wants recorded on every company.
//
// Until now those facts had nowhere of their own. An organisation kept them in
// three places by hand: under `metadata` with keys it made up as it went, as tags
// such as "4-locations", and as a sentence in `pain_points`. The one column
// research could fill, `current_tools`, carried one campaign's vocabulary inside
// prompts every organisation's runs use.
//
// So: a list of declared attributes per instruction stack (a stack is what a
// campaign runs under), each with a key, a label and a kind — text, number, a
// choice from a list, yes/no, or a date. A company's values sit in `attributes`,
// keyed by the attribute's key, and every write merges into what is there rather
// than replacing the column, so a person re-sending their edits can never erase
// what a research run wrote beside them.
//
// Every rule about a declaration or a value lives in TypeScript
// (`packages/instructions/src/attributes.ts`); the unique index below is only
// the guard against two writers creating the same key at the same moment.
//
// `current_tools` is copied into `attributes` here and the column stays for one
// more release: a server instance still running the previous code reads it
// during a rolling deploy; the column itself goes in the next release. The
// copied values are re-declared on each organisation's default research stack
// so they sit under a declared key and stay writable.
//
// No index on `attributes`: the filter compares `attributes->key->>'value'`
// with =, >=, <= and ILIKE, none of which a GIN index can serve. At the
// current size a plain scan is fine; a containment (`@>`) rewrite plus a GIN
// index is the step to take when a count says the scan is too slow.
//
// Every statement here is safe to run twice.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS research_attributes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			-- The campaign this attribute belongs to. Deleting the stack deletes
			-- its declarations; the values already stored on companies stay.
			stack_id UUID NOT NULL REFERENCES instruction_stacks(id) ON DELETE CASCADE,
			-- The name a value is stored under: lowercase letters, digits and
			-- underscores. Never changes once created, because stored values are
			-- filed under it.
			key TEXT NOT NULL,
			-- What people see: "Locations", "Quoting software".
			label TEXT NOT NULL,
			-- text | number | enum | boolean | date, checked in TypeScript.
			kind TEXT NOT NULL,
			-- The allowed words when kind = 'enum', null otherwise.
			enum_values TEXT[],
			-- "per month", "locations": printed after a number.
			unit TEXT,
			-- What to look for on a company's pages. Reaches a research run's first
			-- phase only, never the step that decides what counts as evidence.
			description TEXT,
			is_active BOOLEAN NOT NULL DEFAULT true,
			created_by TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`

	// Race guard only: two admins adding the same key at once end with one row.
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS research_attributes_stack_key_idx
			ON research_attributes (organization_id, stack_id, key)
	`
	// Every company write asks "is this key declared anywhere in the org?".
	yield* sql`
		CREATE INDEX IF NOT EXISTS research_attributes_org_key_idx
			ON research_attributes (organization_id, key)
			WHERE is_active
	`
	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON research_attributes TO app_user, app_service`
	yield* sql`ALTER TABLE research_attributes ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE research_attributes FORCE ROW LEVEL SECURITY`
	yield* sql`DROP POLICY IF EXISTS org_isolation_research_attributes ON research_attributes`
	yield* sql`
		CREATE POLICY org_isolation_research_attributes ON research_attributes
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`

	// Off by default: a research run fills a stack's attributes only once an
	// admin turns this on for that stack.
	yield* sql`
		ALTER TABLE instruction_stacks
			ADD COLUMN IF NOT EXISTS research_fills_attributes BOOLEAN NOT NULL DEFAULT false
	`

	yield* sql`
		ALTER TABLE companies
			ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb
	`

	// A run remembers the attributes it was asked for, and a short name for that
	// set, so one restarted from its row rebuilds its prompts the same way and
	// two runs asked for different facts can be told apart.
	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS attribute_fingerprint TEXT
	`
	yield* sql`
		ALTER TABLE research_runs
			ADD COLUMN IF NOT EXISTS attribute_declarations JSONB NOT NULL DEFAULT '[]'::jsonb
	`

	// Carry over what `current_tools` already holds, deleted companies included
	// so a restore keeps the value. A value a research run wrote keeps that
	// standing — the note under `field_provenance` says which run and which
	// page — so a later run may still update it; anything else was a person's.
	// A company that already holds the key is left alone, which is what makes a
	// second run harmless.
	yield* sql`
		UPDATE companies
		SET attributes = attributes || jsonb_build_object(
			'current_tools',
			jsonb_strip_nulls(jsonb_build_object(
				'value', btrim(current_tools),
				'set_by', CASE WHEN field_provenance ? 'currentTools' THEN 'research' ELSE 'client' END,
				'research_id', field_provenance->'currentTools'->>'runId',
				'source_url', field_provenance->'currentTools'->>'sourceUrl',
				'as_of', field_provenance->'currentTools'->>'asOf'
			))
		)
		WHERE current_tools IS NOT NULL
			AND btrim(current_tools) <> ''
			AND NOT (attributes ? 'current_tools')
	`

	// The note of where a run read the old column moves to the key the value
	// sits under, so the trail is not lost when the column goes. Only where the
	// copy above stamped the value as the run's: a note left behind after a
	// person blanked the column names no value, and stays where it was.
	yield* sql`
		UPDATE companies
		SET field_provenance = (field_provenance - 'currentTools')
			|| jsonb_build_object('attributes.current_tools', field_provenance->'currentTools')
		WHERE field_provenance ? 'currentTools'
			AND attributes->'current_tools'->>'set_by' = 'research'
	`

	// Declare the copied key on each organisation's default research stack, so
	// the value stays editable rather than sitting under a key nobody declared.
	// An organisation with no such stack keeps its values, read-only, until an
	// admin declares the key on a stack of their own.
	yield* sql`
		INSERT INTO research_attributes
			(organization_id, stack_id, key, label, kind, is_active, created_by)
		SELECT s.organization_id, s.id, 'current_tools', 'Current tools', 'text', true, 'migration-0069'
		FROM instruction_stacks s
		WHERE s.agent = 'research'
			AND s.owner_user_id IS NULL
			AND s.is_default
			AND EXISTS (
				SELECT 1 FROM companies c
				WHERE c.organization_id = s.organization_id
					AND c.attributes ? 'current_tools'
			)
		ON CONFLICT (organization_id, stack_id, key) DO NOTHING
	`
})
