import { Effect } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import type { Agent } from './domain'
import { fingerprintTemplates } from './fingerprint'

// ── Pure resolution helpers (unit-tested) ─────────────────────────────────

// The stack that applies to a run, in precedence order:
//   per-run override  >  the user's own default stack  >  the org default
// A user's own default replaces the org's (no merge); an explicit per-run pick
// replaces both. `none` means no templates applied — the run uses only the
// surface's own built-in prompt.
export type StackSource = 'override' | 'user' | 'org' | 'none'

export const pickStackSource = (args: {
	readonly hasOverride: boolean
	readonly hasUserStack: boolean
	readonly hasOrgStack: boolean
}): StackSource =>
	args.hasOverride
		? 'override'
		: args.hasUserStack
			? 'user'
			: args.hasOrgStack
				? 'org'
				: 'none'

// Turn the resolved templates into ordered prompt segments — one trimmed
// segment per template body, in stack order. Blank bodies are dropped so an
// empty template can't emit a dangling segment downstream.
export const assembleSegments = (
	templates: ReadonlyArray<{ readonly body: string }>,
): ReadonlyArray<string> =>
	templates.map(t => t.body.trim()).filter(body => body.length > 0)

// A user's default stack either replaces the org default or extends it (the org
// default, live, followed by the user's own additions).
export type StackComposition = 'replace' | 'extend'

// Keep the first occurrence of each id, preserving order. When an "extend" user
// stack is appended after the org default, a template already in the org block
// keeps its earlier position and the later duplicate is dropped.
export const dedupeKeepFirst = (
	ids: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const seen = new Set<string>()
	const out: Array<string> = []
	for (const id of ids) {
		if (seen.has(id)) continue
		seen.add(id)
		out.push(id)
	}
	return out
}

// An org default stack (owner null) may reference only org-owned templates. A
// personal template inside an org stack is hidden by RLS from other members and
// would be silently dropped from their resolved prompt, so it must be rejected
// when the stack is written. Returns the offending (personal) template ids.
export const personalTemplatesInOrgStack = (
	items: ReadonlyArray<{
		readonly templateId: string
		readonly ownerUserId: string | null
	}>,
): ReadonlyArray<string> =>
	items.filter(item => item.ownerUserId !== null).map(item => item.templateId)

// ── DB resolution (exercised end-to-end when research is wired) ────────────

export interface ResolveInstructionsArgs {
	readonly organizationId: string
	readonly userId: string
	readonly agent: Agent
	readonly overrideTemplateIds?: ReadonlyArray<string> | undefined
}

export interface ResolvedInstructions {
	readonly segments: ReadonlyArray<string>
	readonly fingerprint: string
	readonly templateIds: ReadonlyArray<string>
	readonly source: StackSource
}

// SqlClient.transformResultNames camelCases result keys, so a snake_case column
// like owner_user_id reads back as ownerUserId. The SELECTs keep the real
// (snake) column names; the row types and property access use the camelCase
// keys the client returns.
interface StackRow {
	readonly id: string
	readonly ownerUserId: string | null
	readonly composition: StackComposition
}

interface TemplateRow {
	readonly id: string
	readonly body: string
	readonly updatedAt: string
}

const readStackTemplateIds = (
	sql: SqlClient.SqlClient,
	stackId: string,
): Effect.Effect<ReadonlyArray<string>, SqlError.SqlError> =>
	Effect.map(
		sql<{ templateId: string }>`
			SELECT template_id
			FROM agent_default_stack_items
			WHERE stack_id = ${stackId}
			ORDER BY position ASC
		`,
		rows => rows.map(row => row.templateId),
	)

// Resolve the effective instruction prompt for one agent run. Must run inside
// the request transaction: it reads through RLS, so the org/user GUCs have to
// be set. (Research's run fiber is forked outside the tx — which is exactly why
// resolution happens here and the result is threaded in.)
export const resolveInstructions = (
	args: ResolveInstructionsArgs,
): Effect.Effect<
	ResolvedInstructions,
	SqlError.SqlError,
	SqlClient.SqlClient
> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const override = args.overrideTemplateIds ?? []

		// Candidate default stacks visible to this actor: their own + the org's.
		// Skipped entirely when a per-run override is given.
		const stacks = yield* override.length > 0
			? Effect.succeed<ReadonlyArray<StackRow>>([])
			: sql<StackRow>`
					SELECT id, owner_user_id, composition
					FROM agent_default_stacks
					WHERE organization_id = ${args.organizationId}
						AND agent = ${args.agent}
						AND (owner_user_id = ${args.userId} OR owner_user_id IS NULL)
				`
		const userStack = stacks.find(s => s.ownerUserId === args.userId)
		const orgStack = stacks.find(s => s.ownerUserId === null)

		const source = pickStackSource({
			hasOverride: override.length > 0,
			hasUserStack: userStack !== undefined,
			hasOrgStack: orgStack !== undefined,
		})
		const chosenStack =
			source === 'user' ? userStack : source === 'org' ? orgStack : undefined

		// An "extend" user stack resolves to the live org default followed by the
		// user's own additions (deduped, with the org keeping its position).
		// Every other case reads a single chosen stack, as before.
		const isExtend = source === 'user' && userStack?.composition === 'extend'
		const orderedIds = yield* source === 'override'
			? Effect.succeed<ReadonlyArray<string>>(override)
			: isExtend
				? Effect.gen(function* () {
						const orgIds = orgStack
							? yield* readStackTemplateIds(sql, orgStack.id)
							: []
						const userIds = userStack
							? yield* readStackTemplateIds(sql, userStack.id)
							: []
						return dedupeKeepFirst([...orgIds, ...userIds])
					})
				: chosenStack
					? readStackTemplateIds(sql, chosenStack.id)
					: Effect.succeed<ReadonlyArray<string>>([])

		if (orderedIds.length === 0) {
			return {
				segments: [],
				fingerprint: fingerprintTemplates([]),
				templateIds: [],
				source,
			}
		}

		// RLS silently drops any id the actor can't read (e.g. another member's
		// personal template named in a per-run override) — they never reach the
		// prompt and never enter the fingerprint.
		const rows = yield* sql<TemplateRow>`
			SELECT id, body, EXTRACT(EPOCH FROM updated_at)::text AS updated_at
			FROM instruction_templates
			WHERE id IN ${sql.in([...orderedIds])}
		`
		const byId = new Map(rows.map(row => [row.id, row]))
		const ordered = orderedIds
			.map(id => byId.get(id))
			.filter((row): row is TemplateRow => row !== undefined)

		return {
			segments: assembleSegments(ordered),
			fingerprint: fingerprintTemplates(
				ordered.map(row => ({ id: row.id, updatedAt: row.updatedAt })),
			),
			templateIds: ordered.map(row => row.id),
			source,
		}
	})
