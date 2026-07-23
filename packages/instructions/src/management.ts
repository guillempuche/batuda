import { Effect } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import type { Agent, InstructionTemplate } from './domain'
import { classifyStackTemplates } from './management-logic'
import type { StackComposition } from './resolver'

// SQL-only management operations for instruction templates and default stacks.
// They run as the request-scoped role, so RLS already limits what
// each query can see or write; ownership rules that RLS can't express (the
// admin gate on org-owned writes, fork-on-edit) are composed by the app layer
// on top of these primitives. Every operation requires SqlClient and fails only
// with SqlError, like the resolver.

type Eff<A> = Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>

// ── Templates ──────────────────────────────────────────────────────────────

// transformResultNames camelCases result keys, so snake_case columns read back
// camelCased. The SELECTs keep the real (snake) column names; these row types
// and the accessors below use the camelCase keys the client returns.
interface TemplateRow {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly name: string
	readonly body: string
	readonly createdBy: string
	readonly updatedAt: string
}

const toTemplate = (row: TemplateRow): InstructionTemplate => ({
	id: row.id,
	organizationId: row.organizationId,
	ownerUserId: row.ownerUserId,
	name: row.name,
	body: row.body,
	createdBy: row.createdBy,
	updatedAt: row.updatedAt,
})

export const listTemplates = (): Eff<ReadonlyArray<InstructionTemplate>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// RLS limits this to org-owned templates plus the actor's own.
		const rows = yield* sql<TemplateRow>`
			SELECT id, organization_id, owner_user_id, name, body, created_by, updated_at::text AS updated_at
			FROM instruction_templates
			ORDER BY owner_user_id NULLS FIRST, name ASC
		`
		return rows.map(toTemplate)
	})

export const getTemplate = (id: string): Eff<InstructionTemplate | undefined> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<TemplateRow>`
			SELECT id, organization_id, owner_user_id, name, body, created_by, updated_at::text AS updated_at
			FROM instruction_templates WHERE id = ${id} LIMIT 1
		`
		const row = rows[0]
		return row ? toTemplate(row) : undefined
	})

export interface CreateTemplateInput {
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly name: string
	readonly body: string
	readonly createdBy: string
}

export const createTemplate = (
	input: CreateTemplateInput,
): Eff<InstructionTemplate> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<TemplateRow>`
			INSERT INTO instruction_templates
				(organization_id, owner_user_id, name, body, created_by)
			VALUES (
				${input.organizationId}, ${input.ownerUserId}, ${input.name},
				${input.body}, ${input.createdBy}
			)
			RETURNING id, organization_id, owner_user_id, name, body, created_by, updated_at::text AS updated_at
		`
		const row = rows[0]
		if (!row)
			return yield* Effect.die('instruction template insert returned no row')
		return toTemplate(row)
	})

export const updateTemplateFields = (
	id: string,
	fields: {
		readonly name?: string | undefined
		readonly body?: string | undefined
	},
): Eff<InstructionTemplate | undefined> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// COALESCE keeps the current value when a field is omitted; updated_at
		// bumps so the run cache fingerprint changes.
		const rows = yield* sql<TemplateRow>`
			UPDATE instruction_templates
			SET name = COALESCE(${fields.name ?? null}, name),
				body = COALESCE(${fields.body ?? null}, body),
				updated_at = now()
			WHERE id = ${id}
			RETURNING id, organization_id, owner_user_id, name, body, created_by, updated_at::text AS updated_at
		`
		const row = rows[0]
		return row ? toTemplate(row) : undefined
	})

// Copy a template's text into a new personal template owned by `ownerUserId` —
// the app forks instead of editing in place when a member edits an org template.
export const forkTemplate = (
	id: string,
	opts: { readonly ownerUserId: string; readonly createdBy: string },
): Eff<InstructionTemplate | undefined> =>
	Effect.gen(function* () {
		const source = yield* getTemplate(id)
		if (!source) return undefined
		return yield* createTemplate({
			organizationId: source.organizationId,
			ownerUserId: opts.ownerUserId,
			name: source.name,
			body: source.body,
			createdBy: opts.createdBy,
		})
	})

// Hand a template to another member in the same org. A member can't make this
// change directly: once the new owner is set, the per-user read policy hides the
// row from the member, and the table refuses to write a row they can no longer
// see. So the ownership change runs through a privileged database function that
// re-checks ownership and target membership before reassigning. It returns the
// updated row on success, or no row when the caller doesn't own the template.
export const transferTemplateToUser = (
	id: string,
	targetUserId: string,
): Eff<InstructionTemplate | undefined> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<TemplateRow>`
			SELECT id, organization_id, owner_user_id, name, body, created_by, updated_at::text AS updated_at
			FROM transfer_instruction_template(${id}, ${targetUserId})
		`
		const row = rows[0]
		return row ? toTemplate(row) : undefined
	})

export type DeleteTemplateResult = 'deleted' | 'in_use' | 'not_found'

export const deleteTemplate = (id: string): Eff<DeleteTemplateResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// A template referenced by any stack can't be deleted (FK RESTRICT);
		// pre-check so the caller gets a clean reason instead of a driver error.
		const refs = yield* sql<{ one: number }>`
			SELECT 1 AS one FROM instruction_stack_items WHERE template_id = ${id} LIMIT 1
		`
		if (refs[0]) return 'in_use'
		const deleted = yield* sql<{ id: string }>`
			DELETE FROM instruction_templates WHERE id = ${id} RETURNING id
		`
		return deleted[0] ? 'deleted' : 'not_found'
	})

// ── Stacks ─────────────────────────────────────────────────────────────────

// A stack plus its ordered template ids — the shape every surface renders.
export interface StackSummary {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly agent: Agent
	readonly name: string
	readonly isDefault: boolean
	readonly composition: StackComposition
	readonly templateIds: ReadonlyArray<string>
}

interface StackRow {
	readonly id: string
	readonly organizationId: string
	readonly ownerUserId: string | null
	readonly agent: Agent
	readonly name: string
	readonly isDefault: boolean
	readonly composition: StackComposition
}

const loadStackItemIds = (
	sql: SqlClient.SqlClient,
	stackId: string,
): Eff<ReadonlyArray<string>> =>
	Effect.map(
		sql<{ templateId: string }>`
			SELECT template_id FROM instruction_stack_items
			WHERE stack_id = ${stackId} ORDER BY position ASC
		`,
		rows => rows.map(row => row.templateId),
	)

const withItems = (
	row: StackRow,
	templateIds: ReadonlyArray<string>,
): StackSummary => ({
	id: row.id,
	organizationId: row.organizationId,
	ownerUserId: row.ownerUserId,
	agent: row.agent,
	name: row.name,
	isDefault: row.isDefault,
	composition: row.composition,
	templateIds,
})

const toSummary = (
	sql: SqlClient.SqlClient,
	row: StackRow,
): Eff<StackSummary> =>
	Effect.map(loadStackItemIds(sql, row.id), templateIds =>
		withItems(row, templateIds),
	)

// The ordered template ids of several stacks at once, keyed by stack id. One
// round trip for a whole list, instead of one per stack.
const loadItemsByStack = (
	sql: SqlClient.SqlClient,
	stackIds: ReadonlyArray<string>,
): Eff<Map<string, Array<string>>> =>
	stackIds.length === 0
		? Effect.succeed(new Map())
		: Effect.map(
				sql<{ stackId: string; templateId: string }>`
					SELECT stack_id, template_id FROM instruction_stack_items
					WHERE stack_id IN ${sql.in([...stackIds])}
					ORDER BY position ASC
				`,
				rows => {
					const byStack = new Map<string, Array<string>>()
					for (const row of rows) {
						const list = byStack.get(row.stackId) ?? []
						list.push(row.templateId)
						byStack.set(row.stackId, list)
					}
					return byStack
				},
			)

const STACK_COLUMNS = `id, organization_id, owner_user_id, agent, name, is_default, composition`

// A stack whose name (or default flag) collides with an existing one for the
// same scope+agent raises a unique violation; the SqlError carries a structured
// `reason` tagged UniqueViolation, which maps to a clean `duplicate_name` rather
// than a redacted fault.
const isUniqueViolation = (err: SqlError.SqlError): boolean =>
	err.reason._tag === 'UniqueViolation'

// Every stack readable by the actor (RLS: org stacks + their own), optionally
// filtered to one agent. Ordered so defaults surface first, then by name.
export const listStacks = (agent?: Agent): Eff<ReadonlyArray<StackSummary>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* agent === undefined
			? sql<StackRow>`
					SELECT ${sql.unsafe(STACK_COLUMNS)} FROM instruction_stacks
					ORDER BY owner_user_id NULLS FIRST, agent ASC, is_default DESC, name ASC
				`
			: sql<StackRow>`
					SELECT ${sql.unsafe(STACK_COLUMNS)} FROM instruction_stacks
					WHERE agent = ${agent}
					ORDER BY owner_user_id NULLS FIRST, is_default DESC, name ASC
				`
		const byStack = yield* loadItemsByStack(
			sql,
			rows.map(row => row.id),
		)
		return rows.map(row => withItems(row, byStack.get(row.id) ?? []))
	})

export const getStack = (id: string): Eff<StackSummary | undefined> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<StackRow>`
			SELECT ${sql.unsafe(STACK_COLUMNS)} FROM instruction_stacks
			WHERE id = ${id} LIMIT 1
		`
		const row = rows[0]
		return row ? yield* toSummary(sql, row) : undefined
	})

// The default stack per scope for one agent — what a run with no named stack
// resolves to. Serves the read-only surfaces that show "what fires today".
export const getDefaultStacks = (
	organizationId: string,
	userId: string,
	agent: Agent,
): Eff<{
	readonly org: StackSummary | null
	readonly user: StackSummary | null
}> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<StackRow>`
			SELECT ${sql.unsafe(STACK_COLUMNS)} FROM instruction_stacks
			WHERE organization_id = ${organizationId} AND agent = ${agent}
				AND is_default
				AND (owner_user_id = ${userId} OR owner_user_id IS NULL)
		`
		const orgRow = rows.find(s => s.ownerUserId === null)
		const userRow = rows.find(s => s.ownerUserId === userId)
		const byStack = yield* loadItemsByStack(
			sql,
			rows.map(row => row.id),
		)
		return {
			org: orgRow ? withItems(orgRow, byStack.get(orgRow.id) ?? []) : null,
			user: userRow ? withItems(userRow, byStack.get(userRow.id) ?? []) : null,
		}
	})

export type StackWriteResult =
	| { readonly ok: true; readonly stack: StackSummary }
	| { readonly ok: false; readonly reason: 'duplicate_name' }
	| {
			readonly ok: false
			readonly reason: 'unknown_template'
			readonly missing: ReadonlyArray<string>
	  }
	| {
			readonly ok: false
			readonly reason: 'personal_in_org_stack'
			readonly offending: ReadonlyArray<string>
	  }

// Validate that the referenced templates are readable (RLS) and — for an org
// stack — all org-owned, so a personal template can't be silently dropped from
// other members' resolved prompt. Returns the failing result, or null when ok.
const checkStackTemplates = (
	templateIds: ReadonlyArray<string>,
	isOrgStack: boolean,
): Eff<Extract<StackWriteResult, { ok: false }> | null> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const templates =
			templateIds.length === 0
				? []
				: yield* sql<{ id: string; ownerUserId: string | null }>`
						SELECT id, owner_user_id FROM instruction_templates
						WHERE id IN ${sql.in([...templateIds])}
					`
		const check = classifyStackTemplates({
			requestedIds: templateIds,
			found: templates.map(t => ({ id: t.id, ownerUserId: t.ownerUserId })),
			isOrgStack,
		})
		if (check.kind === 'unknown')
			return { ok: false, reason: 'unknown_template', missing: check.missing }
		if (check.kind === 'personal_in_org')
			return {
				ok: false,
				reason: 'personal_in_org_stack',
				offending: check.offending,
			}
		return null
	})

// Clear the current default for a scope+agent, so a new default can be set
// without tripping the one-default-per-scope unique index.
const clearScopeDefault = (
	sql: SqlClient.SqlClient,
	organizationId: string,
	ownerUserId: string | null,
	agent: Agent,
): Eff<void> =>
	Effect.asVoid(sql`
		UPDATE instruction_stacks SET is_default = false, updated_at = now()
		WHERE organization_id = ${organizationId} AND agent = ${agent}
			AND owner_user_id IS NOT DISTINCT FROM ${ownerUserId}
			AND is_default
	`)

const writeItems = (
	sql: SqlClient.SqlClient,
	organizationId: string,
	stackId: string,
	templateIds: ReadonlyArray<string>,
): Eff<void> =>
	Effect.gen(function* () {
		for (const [position, templateId] of templateIds.entries()) {
			yield* sql`
				INSERT INTO instruction_stack_items (organization_id, stack_id, template_id, position)
				VALUES (${organizationId}, ${stackId}, ${templateId}, ${position})
			`
		}
	})

export interface CreateStackInput {
	readonly organizationId: string
	// null = an org stack; a user id = that user's own.
	readonly ownerUserId: string | null
	readonly agent: Agent
	readonly name: string
	readonly templateIds: ReadonlyArray<string>
	// 'extend' layers the items on the live org default; org stacks pass 'replace'.
	readonly composition: StackComposition
	readonly isDefault: boolean
}

export const createStack = (input: CreateStackInput): Eff<StackWriteResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const invalid = yield* checkStackTemplates(
			input.templateIds,
			input.ownerUserId === null,
		)
		if (invalid) return invalid

		// Setting a new default first demotes the current one for this scope+agent.
		if (input.isDefault)
			yield* clearScopeDefault(
				sql,
				input.organizationId,
				input.ownerUserId,
				input.agent,
			)
		const created = yield* sql<StackRow>`
			INSERT INTO instruction_stacks
				(organization_id, owner_user_id, agent, name, is_default, composition)
			VALUES (
				${input.organizationId}, ${input.ownerUserId}, ${input.agent},
				${input.name}, ${input.isDefault}, ${input.composition}
			)
			RETURNING ${sql.unsafe(STACK_COLUMNS)}
		`
		const row = created[0]
		if (!row)
			return yield* Effect.die('instruction stack insert returned no row')
		yield* writeItems(sql, input.organizationId, row.id, input.templateIds)
		return { ok: true as const, stack: yield* toSummary(sql, row) }
	}).pipe(
		Effect.catchTag('SqlError', err =>
			isUniqueViolation(err)
				? Effect.succeed({
						ok: false as const,
						reason: 'duplicate_name' as const,
					})
				: Effect.fail(err),
		),
	)

export const updateStack = (
	id: string,
	fields: {
		readonly name?: string | undefined
		readonly templateIds?: ReadonlyArray<string> | undefined
		readonly composition?: StackComposition | undefined
	},
): Eff<StackWriteResult | 'not_found'> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const existing = yield* sql<StackRow>`
			SELECT ${sql.unsafe(STACK_COLUMNS)} FROM instruction_stacks
			WHERE id = ${id} LIMIT 1
		`
		const row = existing[0]
		if (!row) return 'not_found'

		if (fields.templateIds !== undefined) {
			const invalid = yield* checkStackTemplates(
				fields.templateIds,
				row.ownerUserId === null,
			)
			if (invalid) return invalid
		}

		// COALESCE keeps the current value when a field is omitted; bumping
		// updated_at is harmless (the fingerprint tracks template edits, not this).
		yield* sql`
			UPDATE instruction_stacks
			SET name = COALESCE(${fields.name ?? null}, name),
				composition = COALESCE(${fields.composition ?? null}, composition),
				updated_at = now()
			WHERE id = ${id}
		`
		if (fields.templateIds !== undefined) {
			yield* sql`DELETE FROM instruction_stack_items WHERE stack_id = ${id}`
			yield* writeItems(sql, row.organizationId, id, fields.templateIds)
		}
		const updated = yield* getStack(id)
		return updated ? { ok: true as const, stack: updated } : 'not_found'
	}).pipe(
		Effect.catchTag('SqlError', err =>
			isUniqueViolation(err)
				? Effect.succeed({
						ok: false as const,
						reason: 'duplicate_name' as const,
					})
				: Effect.fail(err),
		),
	)

export const deleteStack = (id: string): Eff<'deleted' | 'not_found'> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// Items CASCADE with the stack; deleting the default simply leaves the
		// scope+agent with no default.
		const deleted = yield* sql<{ id: string }>`
			DELETE FROM instruction_stacks WHERE id = ${id} RETURNING id
		`
		return deleted[0] ? 'deleted' : 'not_found'
	})

// Make a stack the default for its scope+agent, demoting whatever was default.
export const setDefaultStack = (id: string): Eff<'set' | 'not_found'> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<StackRow>`
			SELECT ${sql.unsafe(STACK_COLUMNS)} FROM instruction_stacks
			WHERE id = ${id} LIMIT 1
		`
		const row = rows[0]
		if (!row) return 'not_found'
		yield* clearScopeDefault(
			sql,
			row.organizationId,
			row.ownerUserId,
			row.agent,
		)
		yield* sql`UPDATE instruction_stacks SET is_default = true, updated_at = now() WHERE id = ${id}`
		return 'set'
	})

// Unset the default for a scope+agent — the row is kept, so a personal clear
// makes the user inherit the org default and an org clear leaves no org default.
export const clearDefaultStack = (
	organizationId: string,
	ownerUserId: string | null,
	agent: Agent,
): Eff<'cleared' | 'not_found'> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const updated = yield* sql<{ id: string }>`
			UPDATE instruction_stacks SET is_default = false, updated_at = now()
			WHERE organization_id = ${organizationId} AND agent = ${agent}
				AND owner_user_id IS NOT DISTINCT FROM ${ownerUserId}
				AND is_default
			RETURNING id
		`
		return updated[0] ? 'cleared' : 'not_found'
	})
