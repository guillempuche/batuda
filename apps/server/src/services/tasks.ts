import { Effect, Layer, ServiceMap } from 'effect'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg } from '@batuda/controllers'

export interface TaskFilters {
	readonly companyId?: string | undefined
	readonly contactId?: string | undefined
	readonly assigneeId?: string | undefined
	readonly status?: string | undefined
	readonly statuses?: ReadonlyArray<string> | undefined
	readonly priority?: string | undefined
	readonly source?: string | undefined
	readonly dueAfter?: string | undefined
	readonly dueBefore?: string | undefined
	readonly overdueOnly?: boolean | undefined
	readonly includeSnoozed?: boolean | undefined
	readonly completed?: boolean | undefined
	readonly search?: string | undefined
}

// `recent` surfaces newest-first for the web inbox; `due` surfaces the most
// overdue first for an agent picking the next thing to act on.
export type TaskSort = 'recent' | 'due'

export interface TaskPage {
	readonly sort: TaskSort
	readonly limit: number
	readonly offset: number
}

// Persistence shared by the HTTP `tasks` handler and the MCP task toolkit.
// Writes funnel through here so the `organization_id` stamp lives in one
// place: the column is NOT NULL with no DB default, and the org_isolation
// RLS policy's WITH CHECK rejects a row whose organization_id doesn't match
// the active org GUC. Reads share one filter builder so `completed`/snooze
// semantics can't drift between the two transports.
export class TaskService extends ServiceMap.Service<TaskService>()(
	'TaskService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			const conditionsFor = (
				orgId: string,
				filters: TaskFilters,
			): Array<Statement.Fragment> => {
				const conditions: Array<Statement.Fragment> = [
					sql`organization_id = ${orgId}`,
				]
				if (filters.companyId)
					conditions.push(sql`company_id = ${filters.companyId}`)
				if (filters.contactId)
					conditions.push(sql`contact_id = ${filters.contactId}`)
				if (filters.assigneeId)
					conditions.push(sql`assignee_id = ${filters.assigneeId}`)
				if (filters.status) conditions.push(sql`status = ${filters.status}`)
				if (filters.statuses && filters.statuses.length > 0)
					conditions.push(sql`status IN ${sql.in([...filters.statuses])}`)
				if (filters.priority)
					conditions.push(sql`priority = ${filters.priority}`)
				if (filters.source) conditions.push(sql`source = ${filters.source}`)
				if (filters.dueAfter)
					conditions.push(sql`due_at >= ${filters.dueAfter}`)
				if (filters.dueBefore)
					conditions.push(sql`due_at <= ${filters.dueBefore}`)
				if (filters.overdueOnly)
					conditions.push(sql`due_at < now() AND status = 'open'`)
				// Snoozed rows hide by default; includeSnoozed surfaces them.
				if (filters.includeSnoozed !== true)
					conditions.push(
						sql`(snoozed_until IS NULL OR snoozed_until <= now())`,
					)
				// `completed=false` excludes cancelled as well as done — a cancelled
				// task is not open work. Shared by both transports so the meaning of
				// the flag can't drift.
				if (filters.completed === true) conditions.push(sql`status = 'done'`)
				if (filters.completed === false)
					conditions.push(sql`status NOT IN ('done', 'cancelled')`)
				if (filters.search) {
					const needle = `%${filters.search.replace(/[\\%_]/g, match => `\\${match}`)}%`
					conditions.push(sql`(title ILIKE ${needle} OR notes ILIKE ${needle})`)
				}
				return conditions
			}

			return {
				create: (data: Record<string, unknown>) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* sql`INSERT INTO tasks ${sql.insert({ ...data, organizationId: currentOrg.id })} RETURNING *`
					}),

				list: (filters: TaskFilters, page: TaskPage) =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const conditions = conditionsFor(currentOrg.id, filters)
						const order =
							page.sort === 'recent'
								? sql`COALESCE(due_at, created_at) DESC`
								: sql`due_at ASC NULLS LAST, created_at ASC`
						return yield* sql`
							SELECT * FROM tasks
							WHERE ${sql.and(conditions)}
							ORDER BY ${order}
							LIMIT ${page.limit} OFFSET ${page.offset}
						`
					}),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
