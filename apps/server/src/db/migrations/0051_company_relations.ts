import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Two companies could not be told they belong together. A holding and the firms
// it owns, a franchisor and its franchisees, a company and the one that bought
// it — all unconnected islands, which is not only a missing fact. They read as
// near-duplicates: same trading name, same town, no reason on file why there are
// two, so somebody eventually merges what should have stayed apart.
//
// `company_relations` names the pair and what one is to the other. Written from
// the subject's side and read from either: "who owns this one" is the same rows
// as "what does this one own", asked the other way round.
//
// The four kinds are the ones the sales work actually turns on. `parent` covers
// ownership either way — the pair is stored once, from the child's side, rather
// than storing a mirror row that can drift out of step with its twin.
// `franchise_of` is deliberately separate: a franchisee is independently owned,
// so treating it as a subsidiary would misstate who decides.
//
// A company cannot be its own parent, and one pair cannot be recorded twice
// under the same kind — both refused at the door, since neither is a thing
// somebody meant.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS company_relations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organization_id TEXT NOT NULL,
			-- The company the statement is about, and the one it is about it with:
			-- "<company> is a <kind> of <related>".
			company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			related_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK (kind IN ('parent', 'franchise_of', 'acquired_by')),
			-- Why somebody recorded it, in their own words: "bought the Girona arm
			-- in 2024". Optional, and only ever explanation.
			note TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			CONSTRAINT company_relations_not_self CHECK (company_id <> related_company_id)
		)
	`

	// One statement per pair per kind. Recorded twice is not a second fact.
	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS company_relations_pair_idx
			ON company_relations (company_id, related_company_id, kind)
	`
	// Both directions are read: "who is above this company" and "what sits under
	// it" are the same rows approached from either end.
	yield* sql`CREATE INDEX IF NOT EXISTS company_relations_company_idx ON company_relations(company_id)`
	yield* sql`CREATE INDEX IF NOT EXISTS company_relations_related_idx ON company_relations(related_company_id)`
	yield* sql`CREATE INDEX IF NOT EXISTS idx_company_relations_org ON company_relations(organization_id)`

	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON company_relations TO app_user, app_service`

	yield* sql`ALTER TABLE company_relations ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE company_relations FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_company_relations ON company_relations
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})
