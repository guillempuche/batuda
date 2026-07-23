import { Context, Effect, Layer } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	type Agent,
	clearDefaultStack,
	createStack,
	createTemplate,
	decideTemplateEdit,
	deleteStack,
	deleteTemplate,
	forkTemplate,
	getDefaultStacks,
	getStack,
	getTemplate,
	type InstructionTemplate,
	listStacks,
	listTemplates,
	type StackComposition,
	type StackSummary,
	type StackWriteResult,
	setDefaultStack,
	transferTemplateToUser,
	updateStack,
	updateTemplateFields,
} from '@batuda/instructions'

// Orchestration for instruction-template management shared by the HTTP and MCP
// surfaces. It captures `sql` once, applies the org-owned admin gate (Better
// Auth member.role, which RLS can't read) and the fork-on-edit rule, and maps
// the package's SQL primitives to discriminated outcomes the transports render.
// SQL faults stay in the Effect error channel; each transport redacts them.

type Scope = 'personal' | 'org'

export type CreateOutcome =
	| { readonly outcome: 'created'; readonly template: InstructionTemplate }
	| { readonly outcome: 'forbidden' }

export type UpdateOutcome =
	| { readonly outcome: 'updated'; readonly template: InstructionTemplate }
	| { readonly outcome: 'forked'; readonly template: InstructionTemplate }
	| { readonly outcome: 'not_found' }

export type DeleteOutcome =
	| { readonly outcome: 'deleted' }
	| { readonly outcome: 'in_use' }
	| { readonly outcome: 'forbidden' }
	| { readonly outcome: 'not_found' }

export type TransferOutcome =
	| { readonly outcome: 'transferred'; readonly template: InstructionTemplate }
	| { readonly outcome: 'forbidden' }
	| { readonly outcome: 'invalid_target' }
	| { readonly outcome: 'not_found' }

// Every stack write funnels through one outcome union: the successful shape
// depends on the action ('created'/'updated' carry the stack; 'set'/'cleared'/
// 'deleted' don't), the gates add 'forbidden'/'not_found', and the validation
// failures ('duplicate_name'/'unknown_template'/'personal_in_org_stack') come
// straight from the package.
export type StackOutcome =
	| { readonly outcome: 'created'; readonly stack: StackSummary }
	| { readonly outcome: 'updated'; readonly stack: StackSummary }
	| { readonly outcome: 'deleted' }
	| { readonly outcome: 'set' }
	| { readonly outcome: 'cleared' }
	| { readonly outcome: 'forbidden' }
	| { readonly outcome: 'not_found' }
	| { readonly outcome: 'duplicate_name' }
	| {
			readonly outcome: 'unknown_template'
			readonly missing: ReadonlyArray<string>
	  }
	| {
			readonly outcome: 'personal_in_org_stack'
			readonly offending: ReadonlyArray<string>
	  }

// Map a package write result to the service outcome. The success tag differs by
// action ('created' vs 'updated'); the failure reasons pass straight through.
const toStackOutcome = (
	result: StackWriteResult,
	success: 'created' | 'updated',
): StackOutcome =>
	result.ok
		? { outcome: success, stack: result.stack }
		: result.reason === 'unknown_template'
			? { outcome: 'unknown_template', missing: result.missing }
			: result.reason === 'personal_in_org_stack'
				? { outcome: 'personal_in_org_stack', offending: result.offending }
				: { outcome: 'duplicate_name' }

// Collapse a SQL fault to a generic defect so neither the HTTP nor the MCP
// transport leaks the driver error (statement, connection) to a client.
const redactSql = <A>(
	eff: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Effect.Effect<A, never, SqlClient.SqlClient> =>
	eff.pipe(
		Effect.catchTag('SqlError', () => Effect.die('internal database error')),
	)

export class InstructionsService extends Context.Service<InstructionsService>()(
	'InstructionsService',
	{
		make: Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient

			// The acting user's role in the active org. RLS already scopes `member`
			// to the active org, so the user id alone identifies the row.
			const isAdmin = (userId: string) =>
				Effect.map(
					sql<{ role: string | null }>`
						SELECT role FROM member WHERE "userId" = ${userId} LIMIT 1
					`,
					rows => {
						const role = rows[0]?.role ?? null
						return role === 'owner' || role === 'admin'
					},
				)

			return {
				listTemplates: () => listTemplates().pipe(redactSql),

				getTemplate: (id: string) => getTemplate(id).pipe(redactSql),

				create: (
					organizationId: string,
					userId: string,
					input: {
						readonly name: string
						readonly body: string
						readonly scope: Scope
					},
				): Effect.Effect<CreateOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						if (input.scope === 'org' && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const template = yield* createTemplate({
							organizationId,
							ownerUserId: input.scope === 'org' ? null : userId,
							name: input.name,
							body: input.body,
							createdBy: userId,
						})
						return { outcome: 'created' as const, template }
					}).pipe(redactSql),

				// Members editing an org template get a personal fork; the owner and
				// org admins edit in place. RLS hides other members' personal
				// templates, so an unreadable id reads as not-found.
				update: (
					userId: string,
					id: string,
					fields: {
						readonly name?: string | undefined
						readonly body?: string | undefined
					},
				): Effect.Effect<UpdateOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const existing = yield* getTemplate(id)
						if (!existing) return { outcome: 'not_found' as const }
						const actorIsAdmin =
							existing.ownerUserId === null ? yield* isAdmin(userId) : false
						const mode = decideTemplateEdit({
							ownerUserId: existing.ownerUserId,
							actorUserId: userId,
							actorIsAdmin,
						})
						if (mode === 'deny') return { outcome: 'not_found' as const }
						if (mode === 'in_place') {
							const template = yield* updateTemplateFields(id, fields)
							return template
								? { outcome: 'updated' as const, template }
								: { outcome: 'not_found' as const }
						}
						// fork: a member editing an org template gets a personal copy. The
						// fork already carries the source text, so falling back to it still
						// returns a valid template if the follow-up edit found no row.
						const forked = yield* forkTemplate(id, {
							ownerUserId: userId,
							createdBy: userId,
						})
						if (!forked) return { outcome: 'not_found' as const }
						const template = yield* updateTemplateFields(forked.id, fields)
						return { outcome: 'forked' as const, template: template ?? forked }
					}).pipe(redactSql),

				remove: (
					userId: string,
					id: string,
				): Effect.Effect<DeleteOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const existing = yield* getTemplate(id)
						if (!existing) return { outcome: 'not_found' as const }
						if (existing.ownerUserId === null && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* deleteTemplate(id)
						return { outcome: result }
					}).pipe(redactSql),

				transfer: (
					organizationId: string,
					userId: string,
					id: string,
					targetUserId: string,
				): Effect.Effect<TransferOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const existing = yield* getTemplate(id)
						if (!existing) return { outcome: 'not_found' as const }
						if (existing.ownerUserId !== userId)
							return { outcome: 'forbidden' as const }
						const target = yield* sql<{ id: string }>`
							SELECT "userId" AS id FROM member
							WHERE "userId" = ${targetUserId}
								AND "organizationId" = ${organizationId} LIMIT 1
						`
						if (!target[0]) return { outcome: 'invalid_target' as const }
						const template = yield* transferTemplateToUser(id, targetUserId)
						return template
							? { outcome: 'transferred' as const, template }
							: { outcome: 'not_found' as const }
					}).pipe(redactSql),

				// Read views kept for the resource + resolution surfaces.
				getDefaultStacks: (
					organizationId: string,
					userId: string,
					agent: Agent,
				): Effect.Effect<
					{
						readonly org: StackSummary | null
						readonly user: StackSummary | null
					},
					never,
					SqlClient.SqlClient
				> => getDefaultStacks(organizationId, userId, agent).pipe(redactSql),

				listStacks: (agent?: Agent) => listStacks(agent).pipe(redactSql),

				getStack: (id: string) => getStack(id).pipe(redactSql),

				createStack: (
					organizationId: string,
					userId: string,
					input: {
						readonly scope: Scope
						readonly agent: Agent
						readonly name: string
						readonly templateIds: ReadonlyArray<string>
						readonly composition?: StackComposition | undefined
						readonly isDefault: boolean
					},
				): Effect.Effect<StackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						if (input.scope === 'org' && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* createStack({
							organizationId,
							ownerUserId: input.scope === 'org' ? null : userId,
							agent: input.agent,
							name: input.name,
							templateIds: input.templateIds,
							// Org stacks are the base of any extend, so they always replace.
							composition:
								input.scope === 'org'
									? 'replace'
									: (input.composition ?? 'replace'),
							isDefault: input.isDefault,
						})
						return toStackOutcome(result, 'created')
					}).pipe(redactSql),

				// Org-owned stacks are admin-gated; a member's own passes. RLS hides
				// another member's personal stack, so an unreadable id is not_found.
				updateStack: (
					userId: string,
					id: string,
					fields: {
						readonly name?: string | undefined
						readonly templateIds?: ReadonlyArray<string> | undefined
						readonly composition?: StackComposition | undefined
					},
				): Effect.Effect<StackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const existing = yield* getStack(id)
						if (!existing) return { outcome: 'not_found' as const }
						if (existing.ownerUserId === null && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* updateStack(id, fields)
						return result === 'not_found'
							? { outcome: 'not_found' as const }
							: toStackOutcome(result, 'updated')
					}).pipe(redactSql),

				deleteStack: (
					userId: string,
					id: string,
				): Effect.Effect<StackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const existing = yield* getStack(id)
						if (!existing) return { outcome: 'not_found' as const }
						if (existing.ownerUserId === null && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* deleteStack(id)
						return { outcome: result }
					}).pipe(redactSql),

				setDefault: (
					userId: string,
					id: string,
				): Effect.Effect<StackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const existing = yield* getStack(id)
						if (!existing) return { outcome: 'not_found' as const }
						if (existing.ownerUserId === null && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* setDefaultStack(id)
						return { outcome: result }
					}).pipe(redactSql),

				clearDefault: (
					organizationId: string,
					userId: string,
					agent: Agent,
					scope: Scope,
				): Effect.Effect<StackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						if (scope === 'org' && !(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* clearDefaultStack(
							organizationId,
							scope === 'org' ? null : userId,
							agent,
						)
						return { outcome: result }
					}).pipe(redactSql),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
