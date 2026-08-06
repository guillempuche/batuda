import { Effect } from 'effect'
import type { SqlClient, Statement } from 'effect/unstable/sql'

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

/**
 * Whether the company a row belongs to is one anybody can still see.
 *
 * Tasks, interactions, proposals and the rest carry a company id but have no
 * deleted mark of their own, so they are hidden by asking about the company they
 * belong to. Written once and pushed into each read rather than spelled out at
 * every query: fifteen hand-written joins are fifteen chances to forget one, and
 * the one forgotten shows work against a company nobody can open.
 *
 * A row belonging to no company is somebody's own work and stays visible — the
 * predicate says nothing about it.
 */
export const companyVisible = (
	sql: SqlClient.SqlClient,
	companyIdColumn: Statement.Fragment,
) => sql`(
	${companyIdColumn} IS NULL
	OR EXISTS (
		SELECT 1 FROM companies visible_company
		WHERE visible_company.id = ${companyIdColumn}
			AND visible_company.deleted_at IS NULL
	)
)`
