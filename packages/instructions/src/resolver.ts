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

// ── Per-run override refs (names or ids) ───────────────────────────────────

// A per-run override lets a caller name templates by human name OR id. This is
// the surface a chat AI uses to apply a specific instruction to one run without
// knowing its UUID. An id passes straight through; a name is matched against the
// templates the actor can read (RLS scopes that to the org's plus their own). A
// name with no match is reported back so the caller can fix the typo, and a name
// that matches more than one template (e.g. a personal and an org template share
// a name) is ambiguous — its candidates come back with their scope so the AI can
// re-ask with the exact id instead of silently running the wrong one.

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuidRef = (ref: string): boolean => UUID_RE.test(ref)

export interface InstructionCandidate {
	readonly id: string
	readonly name: string
	readonly scope: 'personal' | 'org'
}

export interface AmbiguousRef {
	readonly query: string
	readonly candidates: ReadonlyArray<InstructionCandidate>
}

export type ResolveRefsResult =
	| { readonly ok: true; readonly templateIds: ReadonlyArray<string> }
	| {
			readonly ok: false
			readonly unknown: ReadonlyArray<string>
			readonly ambiguous: ReadonlyArray<AmbiguousRef>
	  }

// Pure resolution: given the refs (order preserved, since stack order shapes the
// prompt) and the templates found by name, map each ref to a single id or record
// why it couldn't resolve. Ids are taken at face value; names that match exactly
// one template resolve, the rest are split into unknown vs ambiguous.
export const classifyInstructionRefs = (args: {
	readonly refs: ReadonlyArray<string>
	readonly found: ReadonlyArray<{
		readonly id: string
		readonly name: string
		readonly ownerUserId: string | null
	}>
}): ResolveRefsResult => {
	const byName = new Map<string, Array<InstructionCandidate>>()
	for (const row of args.found) {
		const scope = row.ownerUserId === null ? 'org' : 'personal'
		const list = byName.get(row.name) ?? []
		list.push({ id: row.id, name: row.name, scope })
		byName.set(row.name, list)
	}

	const templateIds: Array<string> = []
	const unknown: Array<string> = []
	const ambiguous: Array<AmbiguousRef> = []
	for (const ref of args.refs) {
		if (isUuidRef(ref)) {
			templateIds.push(ref)
			continue
		}
		const candidates = byName.get(ref) ?? []
		const [first] = candidates
		if (!first) unknown.push(ref)
		else if (candidates.length === 1) templateIds.push(first.id)
		else ambiguous.push({ query: ref, candidates })
	}

	// Collapse repeats so the same template can't appear twice in the prompt —
	// whether the caller listed a name twice, an id twice, or a name alongside its
	// own id (both resolve to one id). First position wins, matching stack order.
	return unknown.length > 0 || ambiguous.length > 0
		? { ok: false, unknown, ambiguous }
		: { ok: true, templateIds: dedupeKeepFirst(templateIds) }
}

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
	readonly templateNames: ReadonlyArray<string>
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
	readonly name: string
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
				templateNames: [],
				source,
			}
		}

		// RLS silently drops any id the actor can't read (e.g. another member's
		// personal template named in a per-run override) — they never reach the
		// prompt and never enter the fingerprint.
		const rows = yield* sql<TemplateRow>`
			SELECT id, name, body, EXTRACT(EPOCH FROM updated_at)::text AS updated_at
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
			templateNames: ordered.map(row => row.name),
			source,
		}
	})

// Turn a caller's per-run override (template names or ids) into the ordered ids
// resolveInstructions expects. Must run inside the request transaction: the name
// lookup reads through RLS, so an actor only ever matches the org's templates and
// their own. Returns the ids on success, or the unresolved names so the caller
// can re-ask (a typo) or disambiguate (a name shared by two templates) before any
// run starts.
export const resolveInstructionRefs = (
	refs: ReadonlyArray<string>,
): Effect.Effect<ResolveRefsResult, SqlError.SqlError, SqlClient.SqlClient> =>
	Effect.gen(function* () {
		if (refs.length === 0) return { ok: true, templateIds: [] }
		const sql = yield* SqlClient.SqlClient
		const names = [...new Set(refs.filter(ref => !isUuidRef(ref)))]
		const found =
			names.length === 0
				? []
				: yield* sql<{
						id: string
						name: string
						ownerUserId: string | null
					}>`
						SELECT id, name, owner_user_id
						FROM instruction_templates
						WHERE name IN ${sql.in(names)}
					`
		return classifyInstructionRefs({ refs, found })
	})
