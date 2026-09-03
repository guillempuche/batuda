import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient, type Statement } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { textAnywhere } from '../../lib/search-text'
import { CurrentUser } from '../current-user'

const REQUEST_DEPENDENCIES = [CurrentOrg, CurrentUser]

const ListMembers = Tool.make('list_members', {
	description:
		"The people who work in this organization — colleagues, not the contacts at companies you sell to. Read it to turn a name somebody said out loud into an id: each row's `user_id` is what a company's ownerId and a task's assignee_id take. It reads the other way too, for putting a name to an owner you were shown, but only by looking down the list — `query` matches names and emails, never ids. Names repeat and nicknames are not stored, so if more than one person matches, stop and ask which; do not take the first row, the order is alphabetical and means nothing. Assigning work to the wrong colleague is quiet, and nobody finds out until the work is missed. Everyone comes back at once — this list is short and never paged.",
	parameters: Schema.Struct({
		query: Schema.optionalKey(Schema.String).annotate({
			description:
				'Part of a name or email address. Matched loosely and case-insensitively, so "ana" finds Ana Ruiz and ana@…',
		}),
	}),
	success: Schema.Struct({
		members: Schema.Array(
			Schema.Struct({
				user_id: Schema.String,
				name: Schema.NullOr(Schema.String),
				email: Schema.String,
				role: Schema.String,
			}),
		),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Members')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

export const MemberTools = Toolkit.make(ListMembers)

export const MemberHandlersLive = MemberTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			list_members: ({ query }) =>
				Effect.gen(function* () {
					// No organisation predicate: row-level security scopes `member` to
					// the org this request runs in, and the join keeps the user rows to
					// those members. The user table carries no policy of its own, so
					// reading it any other way would reach across organisations.
					const conditions: Array<Statement.Fragment> = [sql`TRUE`]
					if (query !== undefined) {
						const like = textAnywhere(query)
						conditions.push(
							sql`(normalize(u.name) ILIKE ${like} OR u.email ILIKE ${like})`,
						)
					}
					// Read back camelCase whatever the column is called — the SQL client
					// renames every key on the way out — and spelled snake_case again
					// for the tool result, the way the rest of this surface reads.
					const rows = yield* sql<{
						userId: string
						name: string | null
						email: string
						role: string
					}>`
						SELECT u.id AS "userId", u.name, u.email, m.role
						FROM member m
						JOIN "user" u ON u.id = m."userId"
						WHERE ${sql.and(conditions)}
						ORDER BY u.name NULLS LAST, u.email
					`
					return {
						members: rows.map(row => ({
							user_id: row.userId,
							name: row.name,
							email: row.email,
							role: row.role,
						})),
					}
				}).pipe(Effect.orDie),
		}
	}),
)
