import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// user_research_policy, provider_quotas, and provider_usage are keyed by
// user_id and intentionally span orgs (a user's quota travels with them).
// 0001_initial.ts left them without RLS — every app_user session could
// read every other user's research budget and provider quotas. Per-user
// policies key on the `app.current_user_id` GUC, which the app_user
// session is expected to set per request.
//
// FORCE ROW LEVEL SECURITY makes the policy apply to the table owner
// too. app_service (BYPASSRLS) bypasses the policy entirely, so worker
// and cron paths continue to read across users without policy change.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`ALTER TABLE user_research_policy ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE user_research_policy FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY user_isolation_user_research_policy ON user_research_policy
			TO app_user
			USING (user_id = current_setting('app.current_user_id', true))
			WITH CHECK (user_id = current_setting('app.current_user_id', true))
	`

	yield* sql`ALTER TABLE provider_quotas ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE provider_quotas FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY user_isolation_provider_quotas ON provider_quotas
			TO app_user
			USING (user_id = current_setting('app.current_user_id', true))
			WITH CHECK (user_id = current_setting('app.current_user_id', true))
	`

	yield* sql`ALTER TABLE provider_usage ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE provider_usage FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY user_isolation_provider_usage ON provider_usage
			TO app_user
			USING (user_id = current_setting('app.current_user_id', true))
			WITH CHECK (user_id = current_setting('app.current_user_id', true))
	`
})
