import { Console, Effect, Option } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { printTable } from '../lib/table'

// Read-only inspector over the seeded mock data. Each entity lists by the key
// you actually navigate by (org/company/page slug, template/inbox id), so e2e
// and agent-browser setup can look up a real value instead of guessing. The
// CLI's DB role bypasses RLS, so this sees every org at once.

export const ENTITY_NAMES = [
	'orgs',
	'members',
	'companies',
	'templates',
	'stacks',
	'inboxes',
	'tasks',
	'pages',
] as const

export type EntityName = (typeof ENTITY_NAMES)[number]

type Row = Record<string, unknown>

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v))

// Width 0 means "don't pad" — used for the last column so it doesn't trail spaces.
const col = (header: string, width: number, key: string) => ({
	header,
	width,
	value: (r: Row) => cell(r[key]),
})

export const dataInspect = (entity: Option.Option<EntityName>, json: boolean) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		// Better-Auth tables (user/member/organization) use camelCase columns;
		// the app tables use snake_case — hence the mixed quoting below.
		const entities = {
			orgs: {
				columns: [
					col('Slug', 16, 'slug'),
					col('Name', 28, 'name'),
					col('Members', 0, 'members'),
				],
				rows: () => sql<Row>`
					SELECT o.slug, o.name,
						(SELECT count(*) FROM member m WHERE m."organizationId" = o.id) AS members
					FROM organization o ORDER BY o.slug`,
			},
			members: {
				columns: [
					col('Email', 34, 'email'),
					col('Org', 16, 'org'),
					col('Role', 0, 'role'),
				],
				rows: () => sql<Row>`
					SELECT u.email, o.slug AS org, m.role
					FROM member m
					JOIN "user" u ON u.id = m."userId"
					JOIN organization o ON o.id = m."organizationId"
					ORDER BY u.email, o.slug`,
			},
			companies: {
				columns: [
					col('Org', 14, 'org'),
					col('Slug', 24, 'slug'),
					col('Name', 28, 'name'),
					col('Status', 0, 'status'),
				],
				rows: () => sql<Row>`
					SELECT o.slug AS org, c.slug, c.name, c.status
					FROM companies c JOIN organization o ON o.id = c.organization_id
					WHERE c.deleted_at IS NULL
					ORDER BY o.slug, c.name`,
			},
			templates: {
				columns: [
					col('Org', 14, 'org'),
					col('Id', 38, 'id'),
					col('Name', 30, 'name'),
					col('Owner', 0, 'owner'),
				],
				rows: () => sql<Row>`
					SELECT o.slug AS org, t.id, t.name,
						CASE WHEN t.owner_user_id IS NULL THEN 'org' ELSE 'user' END AS owner
					FROM instruction_templates t JOIN organization o ON o.id = t.organization_id
					ORDER BY o.slug, t.name`,
			},
			stacks: {
				columns: [
					col('Org', 14, 'org'),
					col('Scope', 8, 'scope'),
					col('Agent', 12, 'agent'),
					col('Composition', 14, 'composition'),
					col('Items', 0, 'items'),
				],
				rows: () => sql<Row>`
					SELECT o.slug AS org,
						CASE WHEN s.owner_user_id IS NULL THEN 'org' ELSE 'user' END AS scope,
						s.agent, s.composition,
						(SELECT count(*) FROM agent_default_stack_items i WHERE i.stack_id = s.id) AS items
					FROM agent_default_stacks s JOIN organization o ON o.id = s.organization_id
					ORDER BY o.slug, scope, s.agent`,
			},
			inboxes: {
				columns: [
					col('Org', 14, 'org'),
					col('Email', 32, 'email'),
					col('Name', 24, 'displayName'),
					col('Active', 0, 'active'),
				],
				rows: () => sql<Row>`
					SELECT o.slug AS org, i.email, i.display_name, i.active
					FROM inboxes i JOIN organization o ON o.id = i.organization_id
					ORDER BY o.slug, i.email`,
			},
			tasks: {
				columns: [
					col('Org', 14, 'org'),
					col('Title', 44, 'title'),
					col('Status', 0, 'status'),
				],
				rows: () => sql<Row>`
					SELECT o.slug AS org, t.title, t.status
					FROM tasks t JOIN organization o ON o.id = t.organization_id
					ORDER BY o.slug, t.created_at`,
			},
			pages: {
				columns: [
					col('Org', 14, 'org'),
					col('Slug', 28, 'slug'),
					col('Lang', 6, 'lang'),
					col('Status', 0, 'status'),
				],
				rows: () => sql<Row>`
					SELECT o.slug AS org, p.slug, p.lang, p.status
					FROM pages p JOIN organization o ON o.id = p.organization_id
					ORDER BY o.slug, p.slug`,
			},
		}

		if (Option.isNone(entity)) {
			const counts: Array<Row> = []
			for (const name of ENTITY_NAMES) {
				const rows = yield* entities[name].rows()
				counts.push({ entity: name, rows: rows.length })
			}
			if (json) {
				yield* Console.log(JSON.stringify(counts))
				return
			}
			yield* Console.log('')
			yield* printTable(
				[col('Entity', 16, 'entity'), col('Rows', 0, 'rows')],
				counts,
			)
			yield* Console.log('')
			yield* Console.log(
				'  `pnpm cli data <entity>` for rows · --json to script',
			)
			yield* Console.log('')
			return
		}

		const def = entities[entity.value]
		const rows = yield* def.rows()
		if (json) {
			yield* Console.log(JSON.stringify(rows, null, 2))
			return
		}
		yield* Console.log('')
		yield* printTable(def.columns, rows)
		yield* Console.log('')
		yield* Console.log(`  ${rows.length} ${entity.value}`)
		yield* Console.log('')
	})
