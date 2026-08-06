import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { NotFound } from '@batuda/controllers'

/**
 * Refuse to hang anything off a company that is out of view.
 *
 * The foreign key only says a company exists, not that anybody can see it, so a
 * deleted one still satisfies it. Something added to it afterwards would show in
 * its own list, link to a page that cannot be opened, and — because it was never
 * hidden by the deletion that hid the rest — stay behind when the company comes
 * back, leaving the account holding people nobody deleted and nobody expected.
 *
 * One place rather than one check per writer: every way of adding to a company
 * has to ask the same question, and a check written out at each of them is one
 * somebody eventually forgets.
 */
export const requireLiveCompany = (
	sql: SqlClient.SqlClient,
	orgId: string,
	companyId: string | null | undefined,
) =>
	Effect.gen(function* () {
		if (typeof companyId !== 'string' || companyId === '') return
		const rows = yield* sql`
			SELECT 1 FROM companies
			WHERE id = ${companyId}
				AND organization_id = ${orgId}
				AND deleted_at IS NULL
			LIMIT 1
		`.pipe(Effect.orDie)
		if (rows.length === 0)
			return yield* new NotFound({ entity: 'company', id: companyId })
	})
