import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import { BadRequest, CurrentOrg } from '@batuda/controllers'

/**
 * Refuse a person who does not work here.
 *
 * Anywhere a record names somebody — the colleague who owns a company, the one
 * a task is waiting on — the column holds a plain Better Auth user id with no
 * foreign key behind it, because the auth stack owns the user table and runs its
 * own migrations. Nothing in the database will object to an id from another
 * organisation, or to one that was never a person at all: the write lands, and
 * the record then matches no per-person view, so the work simply stops appearing
 * on anybody's list. Nobody is told.
 *
 * This lives beside the write rather than in front of it so every way in reaches
 * it — the tools an assistant calls and the web app's own requests alike.
 */
export const requireOrgMembers = (
	sql: SqlClient.SqlClient,
	// Taken as unknown because callers hand over raw field maps: an id that is
	// not a string was never a person, and is refused below rather than here.
	ids: ReadonlyArray<unknown>,
) =>
	Effect.gen(function* () {
		const currentOrg = yield* CurrentOrg
		const wanted = [
			...new Set(
				ids.filter((id): id is string => typeof id === 'string' && id !== ''),
			),
		]
		if (wanted.length === 0) return
		// Named in the query as well as left to row-level security: this is the
		// check that decides whether a person is one of ours, so it should not
		// depend on the caller having entered org scope correctly.
		const rows = yield* sql<{ userId: string }>`
			SELECT "userId" FROM member
			WHERE "organizationId" = ${currentOrg.id}
				AND "userId" IN ${sql.in(wanted)}
		`
		const known = new Set(rows.map(row => row.userId))
		const stranger = wanted.find(id => !known.has(id))
		if (stranger !== undefined)
			return yield* Effect.fail(
				new BadRequest({
					message: `"${stranger}" is not a member of this organization, so nothing was saved — call list_members for the ids of people who are, then try again.`,
				}),
			)
	})
