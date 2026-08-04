import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient, type Statement } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

import { CurrentUser } from '../current-user'

const REQUEST_DEPENDENCIES = [CurrentOrg, CurrentUser]

const ListMembers = Tool.make('list_members', {
	description:
		"The people who work in this organisation — colleagues, not the contacts at companies you sell to. Read it to turn a name somebody said out loud into the id every other tool wants: a company's owner, a task's assignee. Names repeat and nicknames are not stored, so when two people could be meant, ask which rather than guessing — assigning work to the wrong colleague is quiet, and nobody finds out until the work is missed. `query` narrows by name or email; omit it for everyone.",
	parameters: Schema.Struct({
		query: Schema.optional(Schema.String).annotate({
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
						const like = `%${query}%`
						conditions.push(
							sql`(u.name ILIKE ${like} OR u.email ILIKE ${like})`,
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
