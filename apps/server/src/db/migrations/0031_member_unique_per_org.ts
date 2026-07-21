import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// One membership row per person per organization.
//
// Better Auth's own schema has no constraint here: adding someone checks first
// whether they are already in the organization, then inserts. Two people adding
// the same person at the same moment both pass that check and both insert, and
// the reads afterwards take the first row they find — so the duplicate stays
// invisible while the person quietly occupies two seats and shows up twice in
// the roster.
//
// Nothing in the application relies on being able to hold two rows for the same
// pair, so the database is the right place to say so once.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	// Fold away any pair that already doubled up before adding the constraint,
	// keeping the row the person actually joined on. Without this the index
	// creation fails on exactly the databases that most need it.
	yield* sql`
		DELETE FROM member m
		USING member keep
		WHERE m."organizationId" = keep."organizationId"
			AND m."userId" = keep."userId"
			AND (
				keep."createdAt" < m."createdAt"
				OR (keep."createdAt" = m."createdAt" AND keep.id < m.id)
			)
	`

	yield* sql`
		CREATE UNIQUE INDEX IF NOT EXISTS member_org_user_unique
			ON member ("organizationId", "userId")
	`
})
