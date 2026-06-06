import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// research_cache had no organization_id and used key_hash as its sole primary
// key, so two organizations whose runs hashed to the same key collided — the
// second write overwrote the first row, and a cross-org cache hit could surface
// another organization's result. Scope the cache per organization: add
// organization_id, key on (organization_id, key_hash), and apply the same
// org-isolation RLS as research_runs — request-scope reads (app_user) are
// filtered by the org GUC, while privileged writes set organization_id
// explicitly. Existing rows carry no org, so they're truncated; research_cache
// is a pure cache and re-warms on the next miss.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`TRUNCATE research_cache`
	yield* sql`ALTER TABLE research_cache ADD COLUMN organization_id text NOT NULL`
	yield* sql`ALTER TABLE research_cache DROP CONSTRAINT research_cache_pkey`
	yield* sql`ALTER TABLE research_cache ADD PRIMARY KEY (organization_id, key_hash)`

	yield* sql`DROP INDEX IF EXISTS research_cache_user_expires_idx`
	yield* sql`
		CREATE INDEX IF NOT EXISTS research_cache_org_user_expires_idx
			ON research_cache (organization_id, user_id, expires_at)
	`

	yield* sql`ALTER TABLE research_cache ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE research_cache FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_research_cache ON research_cache
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`
})
