import type { SqlClient, Statement } from 'effect/unstable/sql'

/**
 * Whose companies to look at, as both the company list and the conversation
 * list ask it.
 *
 * `none` is the companies nobody has taken, and it sits beside the ids rather
 * than replacing them: "mine or going spare" is one question, and an owner
 * column has no value standing for nobody to match against.
 *
 * Written once because two screens ask it: a list of companies filtered by
 * owner and a list of conversations filtered by the owner of the company they
 * are with have to agree about what "nobody" means.
 */
export const UNASSIGNED = 'none'

export const ownerCondition = (
	sql: SqlClient.SqlClient,
	column: Statement.Fragment,
	owners: ReadonlyArray<string>,
): Statement.Fragment => {
	const unassigned = owners.includes(UNASSIGNED)
	const ids = owners.filter(id => id !== UNASSIGNED)
	if (ids.length === 0) return sql`${column} IS NULL`
	if (!unassigned) return sql`${column} IN ${sql.in(ids)}`
	return sql`(${column} IS NULL OR ${column} IN ${sql.in(ids)})`
}
