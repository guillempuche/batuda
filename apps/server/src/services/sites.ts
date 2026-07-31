import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

/**
 * The branch to store for a person, checked against the company they work for.
 * A foreign key only says the branch exists, not whose it is, so without this
 * somebody could be filed under another organisation's shop.
 *
 * Two answers, and the difference matters: `undefined` means store nothing and
 * change nothing, `null` means the caller cleared the branch on purpose, and a
 * string is one that checked out.
 *
 * A branch that fails the check answers `undefined`, not `null` — a typo'd or
 * stale id must never wipe the branch somebody already recorded. Saying nothing
 * is the safe reading of a guess, and on a new person it stores nothing anyway.
 */
export const ownedSiteId = (
	sql: SqlClient.SqlClient,
	orgId: string,
	companyId: string,
	siteId: string | null | undefined,
) =>
	Effect.gen(function* () {
		if (siteId === undefined) return undefined
		if (siteId === null) return null
		const rows = yield* sql`
			SELECT id FROM sites
			WHERE id = ${siteId}
				AND company_id = ${companyId}
				AND organization_id = ${orgId}
			LIMIT 1
		`
		return rows.length > 0 ? siteId : undefined
	})
