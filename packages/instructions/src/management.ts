import { Effect } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import type { Agent, InstructionTemplate } from './domain'
import { classifyStackTemplates } from './management-logic'

// SQL-only management operations for instruction templates, default stacks, and
// donations. They run as the request-scoped role, so RLS already limits what
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
	readonly sourcePresetId: string | null
	readonly createdBy: string
	readonly updatedAt: string
}

const toTemplate = (row: TemplateRow): InstructionTemplate => ({
	id: row.id,
	organizationId: row.organizationId,
	ownerUserId: row.ownerUserId,
	name: row.name,
	body: row.body,
	sourcePresetId: row.sourcePresetId,
	createdBy: row.createdBy,
	updatedAt: row.updatedAt,
})

export const listTemplates = (): Eff<ReadonlyArray<InstructionTemplate>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// RLS limits this to org-owned templates plus the actor's own.
		const rows = yield* sql<TemplateRow>`
			SELECT id, organization_id, owner_user_id, name, body, source_preset_id, created_by, updated_at::text AS updated_at
			FROM instruction_templates
			ORDER BY owner_user_id NULLS FIRST, name ASC
		`
		return rows.map(toTemplate)
	})

export const getTemplate = (id: string): Eff<InstructionTemplate | undefined> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<TemplateRow>`
			SELECT id, organization_id, owner_user_id, name, body, source_preset_id, created_by, updated_at::text AS updated_at
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
	readonly sourcePresetId?: string | null
}

export const createTemplate = (
	input: CreateTemplateInput,
): Eff<InstructionTemplate> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<TemplateRow>`
			INSERT INTO instruction_templates
				(organization_id, owner_user_id, name, body, source_preset_id, created_by)
			VALUES (
				${input.organizationId}, ${input.ownerUserId}, ${input.name},
				${input.body}, ${input.sourcePresetId ?? null}, ${input.createdBy}
			)
			RETURNING id, organization_id, owner_user_id, name, body, source_preset_id, created_by, updated_at::text AS updated_at
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
			RETURNING id, organization_id, owner_user_id, name, body, source_preset_id, created_by, updated_at::text AS updated_at
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
			sourcePresetId: source.sourcePresetId,
		})
	})

// Hand a template to another member. RLS lets the owner target their own row and
// only requires the new owner to stay in-org, so the app validates the target.
export const transferTemplateToUser = (
	id: string,
	targetUserId: string,
): Eff<InstructionTemplate | undefined> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<TemplateRow>`
			UPDATE instruction_templates
			SET owner_user_id = ${targetUserId}, updated_at = now()
			WHERE id = ${id}
			RETURNING id, organization_id, owner_user_id, name, body, source_preset_id, created_by, updated_at::text AS updated_at
		`
		const row = rows[0]
		return row ? toTemplate(row) : undefined
	})

export type DeleteTemplateResult = 'deleted' | 'in_use' | 'not_found'

export const deleteTemplate = (id: string): Eff<DeleteTemplateResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// A template referenced by any default stack can't be deleted (FK
		// RESTRICT); pre-check so the caller gets a clean reason instead of a
		// driver error.
		const refs = yield* sql<{ one: number }>`
			SELECT 1 AS one FROM agent_default_stack_items WHERE template_id = ${id} LIMIT 1
		`
		if (refs[0]) return 'in_use'
		const deleted = yield* sql<{ id: string }>`
			DELETE FROM instruction_templates WHERE id = ${id} RETURNING id
		`
		return deleted[0] ? 'deleted' : 'not_found'
	})

// ── Default stacks ───────────────────────────────────────────────────────────

export interface StackView {
	readonly id: string
	readonly templateIds: ReadonlyArray<string>
}

const loadStackItemIds = (
	sql: SqlClient.SqlClient,
	stackId: string,
): Eff<ReadonlyArray<string>> =>
	Effect.map(
		sql<{ templateId: string }>`
			SELECT template_id FROM agent_default_stack_items
			WHERE stack_id = ${stackId} ORDER BY position ASC
		`,
		rows => rows.map(row => row.templateId),
	)

export const getDefaultStacks = (
	organizationId: string,
	userId: string,
	agent: Agent,
): Eff<{ readonly org: StackView | null; readonly user: StackView | null }> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const stacks = yield* sql<{ id: string; ownerUserId: string | null }>`
			SELECT id, owner_user_id FROM agent_default_stacks
			WHERE organization_id = ${organizationId} AND agent = ${agent}
				AND (owner_user_id = ${userId} OR owner_user_id IS NULL)
		`
		const orgRow = stacks.find(s => s.ownerUserId === null)
		const userRow = stacks.find(s => s.ownerUserId === userId)
		const org = orgRow
			? { id: orgRow.id, templateIds: yield* loadStackItemIds(sql, orgRow.id) }
			: null
		const user = userRow
			? {
					id: userRow.id,
					templateIds: yield* loadStackItemIds(sql, userRow.id),
				}
			: null
		return { org, user }
	})

export interface SetDefaultStackInput {
	readonly organizationId: string
	// null = the org default stack; a user id = that user's own.
	readonly ownerUserId: string | null
	readonly agent: Agent
	readonly templateIds: ReadonlyArray<string>
}

export type SetDefaultStackResult =
	| { readonly ok: true; readonly stackId: string }
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

export const setDefaultStack = (
	input: SetDefaultStackInput,
): Eff<SetDefaultStackResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// Validate the referenced templates are readable (RLS) and — for an org
		// stack — all org-owned, so a personal template can't be silently dropped
		// from other members' resolved prompt.
		const templates =
			input.templateIds.length === 0
				? []
				: yield* sql<{ id: string; ownerUserId: string | null }>`
						SELECT id, owner_user_id FROM instruction_templates
						WHERE id IN ${sql.in([...input.templateIds])}
					`
		const check = classifyStackTemplates({
			requestedIds: input.templateIds,
			found: templates.map(t => ({ id: t.id, ownerUserId: t.ownerUserId })),
			isOrgStack: input.ownerUserId === null,
		})
		if (check.kind === 'unknown')
			return { ok: false, reason: 'unknown_template', missing: check.missing }
		if (check.kind === 'personal_in_org')
			return {
				ok: false,
				reason: 'personal_in_org_stack',
				offending: check.offending,
			}

		// Upsert the stack row (IS NOT DISTINCT FROM matches the null org owner),
		// then replace its items in order.
		const existing = yield* sql<{ id: string }>`
			SELECT id FROM agent_default_stacks
			WHERE organization_id = ${input.organizationId} AND agent = ${input.agent}
				AND owner_user_id IS NOT DISTINCT FROM ${input.ownerUserId}
			LIMIT 1
		`
		let stackId: string
		const existingRow = existing[0]
		if (existingRow) {
			stackId = existingRow.id
			yield* sql`DELETE FROM agent_default_stack_items WHERE stack_id = ${stackId}`
			yield* sql`UPDATE agent_default_stacks SET updated_at = now() WHERE id = ${stackId}`
		} else {
			const created = yield* sql<{ id: string }>`
				INSERT INTO agent_default_stacks (organization_id, owner_user_id, agent)
				VALUES (${input.organizationId}, ${input.ownerUserId}, ${input.agent})
				RETURNING id
			`
			const createdRow = created[0]
			if (!createdRow)
				return yield* Effect.die('agent default stack insert returned no row')
			stackId = createdRow.id
		}
		for (const [position, templateId] of input.templateIds.entries()) {
			yield* sql`
				INSERT INTO agent_default_stack_items (organization_id, stack_id, template_id, position)
				VALUES (${input.organizationId}, ${stackId}, ${templateId}, ${position})
			`
		}
		return { ok: true, stackId }
	})

// Drop a user's own default stack so they inherit the org default again. Scoped
// to the actor's own stack — never the org default.
export const clearUserDefaultStack = (
	organizationId: string,
	userId: string,
	agent: Agent,
): Eff<'cleared' | 'not_found'> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const deleted = yield* sql<{ id: string }>`
			DELETE FROM agent_default_stacks
			WHERE organization_id = ${organizationId} AND agent = ${agent}
				AND owner_user_id = ${userId}
			RETURNING id
		`
		return deleted[0] ? 'cleared' : 'not_found'
	})

// ── Donations ────────────────────────────────────────────────────────────────

interface DonationRow {
	readonly id: string
	readonly organizationId: string
	readonly sourceTemplateId: string | null
	readonly createdTemplateId: string | null
	readonly name: string
	readonly body: string
	readonly proposedBy: string
	readonly status: string
	readonly resolvedBy: string | null
	readonly createdAt: string
	readonly resolvedAt: string | null
}

export interface Donation {
	readonly id: string
	readonly organizationId: string
	readonly sourceTemplateId: string | null
	readonly createdTemplateId: string | null
	readonly name: string
	readonly body: string
	readonly proposedBy: string
	readonly status: 'pending' | 'accepted' | 'rejected'
	readonly resolvedBy: string | null
	readonly createdAt: string
	readonly resolvedAt: string | null
}

const toDonation = (row: DonationRow): Donation => ({
	id: row.id,
	organizationId: row.organizationId,
	sourceTemplateId: row.sourceTemplateId,
	createdTemplateId: row.createdTemplateId,
	name: row.name,
	body: row.body,
	proposedBy: row.proposedBy,
	status: row.status as Donation['status'],
	resolvedBy: row.resolvedBy,
	createdAt: row.createdAt,
	resolvedAt: row.resolvedAt,
})

export interface ProposeDonationInput {
	readonly organizationId: string
	readonly sourceTemplateId: string
	readonly name: string
	readonly body: string
	readonly proposedBy: string
}

export const proposeDonation = (input: ProposeDonationInput): Eff<Donation> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<DonationRow>`
			INSERT INTO instruction_template_donations
				(organization_id, source_template_id, name, body, proposed_by)
			VALUES (
				${input.organizationId}, ${input.sourceTemplateId},
				${input.name}, ${input.body}, ${input.proposedBy}
			)
			RETURNING id, organization_id, source_template_id, created_template_id, name, body, proposed_by, status, resolved_by, created_at::text AS created_at, resolved_at::text AS resolved_at
		`
		const row = rows[0]
		if (!row) return yield* Effect.die('donation insert returned no row')
		return toDonation(row)
	})

export const listDonations = (
	status?: Donation['status'] | undefined,
): Eff<ReadonlyArray<Donation>> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* status === undefined
			? sql<DonationRow>`
					SELECT id, organization_id, source_template_id, created_template_id, name, body, proposed_by, status, resolved_by, created_at::text AS created_at, resolved_at::text AS resolved_at
					FROM instruction_template_donations ORDER BY created_at DESC
				`
			: sql<DonationRow>`
					SELECT id, organization_id, source_template_id, created_template_id, name, body, proposed_by, status, resolved_by, created_at::text AS created_at, resolved_at::text AS resolved_at
					FROM instruction_template_donations WHERE status = ${status} ORDER BY created_at DESC
				`
		return rows.map(toDonation)
	})

export type AcceptDonationResult =
	| { readonly ok: true; readonly template: InstructionTemplate }
	| { readonly ok: false; readonly reason: 'not_found' | 'not_pending' }

// Accept a proposal by creating a fresh org-owned template from its snapshot,
// then closing the proposal. A new row (not an ownership flip of the proposer's
// personal template) keeps the accept within the admin's own RLS write scope.
export const acceptDonation = (
	id: string,
	resolvedBy: string,
): Eff<AcceptDonationResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<DonationRow>`
			SELECT id, organization_id, source_template_id, created_template_id, name, body, proposed_by, status, resolved_by, created_at::text AS created_at, resolved_at::text AS resolved_at
			FROM instruction_template_donations WHERE id = ${id} LIMIT 1
		`
		const donation = rows[0]
		if (!donation) return { ok: false, reason: 'not_found' }
		if (donation.status !== 'pending')
			return { ok: false, reason: 'not_pending' }
		const template = yield* createTemplate({
			organizationId: donation.organizationId,
			ownerUserId: null,
			name: donation.name,
			body: donation.body,
			createdBy: resolvedBy,
		})
		yield* sql`
			UPDATE instruction_template_donations
			SET status = 'accepted', created_template_id = ${template.id},
				resolved_by = ${resolvedBy}, resolved_at = now()
			WHERE id = ${id}
		`
		return { ok: true, template }
	})

export type RejectDonationResult = 'rejected' | 'not_found' | 'not_pending'

export const rejectDonation = (
	id: string,
	resolvedBy: string,
): Eff<RejectDonationResult> =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const updated = yield* sql<{ id: string }>`
			UPDATE instruction_template_donations
			SET status = 'rejected', resolved_by = ${resolvedBy}, resolved_at = now()
			WHERE id = ${id} AND status = 'pending'
			RETURNING id
		`
		if (updated[0]) return 'rejected'
		const exists = yield* sql<{ id: string }>`
			SELECT id FROM instruction_template_donations WHERE id = ${id} LIMIT 1
		`
		return exists[0] ? 'not_pending' : 'not_found'
	})
