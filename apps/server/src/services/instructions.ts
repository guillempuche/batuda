import { Effect, Layer, ServiceMap } from 'effect'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	type Agent,
	acceptDonation,
	clearUserDefaultStack,
	createTemplate,
	type Donation,
	decideTemplateEdit,
	deleteTemplate,
	forkTemplate,
	getDefaultStacks,
	getTemplate,
	type InstructionTemplate,
	listDonations,
	listTemplates,
	proposeDonation,
	rejectDonation,
	type StackComposition,
	type StackView,
	setDefaultStack,
	transferTemplateToUser,
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

export type SetStackOutcome =
	| { readonly outcome: 'set'; readonly stackId: string }
	| { readonly outcome: 'forbidden' }
	| {
			readonly outcome: 'unknown_template'
			readonly missing: ReadonlyArray<string>
	  }
	| {
			readonly outcome: 'personal_in_org_stack'
			readonly offending: ReadonlyArray<string>
	  }

export type DonateOutcome =
	| { readonly outcome: 'proposed'; readonly donation: Donation }
	| { readonly outcome: 'forbidden' }
	| { readonly outcome: 'not_found' }

export type ResolveDonationOutcome =
	| { readonly outcome: 'accepted'; readonly template: InstructionTemplate }
	| { readonly outcome: 'rejected' }
	| { readonly outcome: 'forbidden' }
	| { readonly outcome: 'not_found' }
	| { readonly outcome: 'not_pending' }

// Collapse a SQL fault to a generic defect so neither the HTTP nor the MCP
// transport leaks the driver error (statement, connection) to a client.
const redactSql = <A>(
	eff: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Effect.Effect<A, never, SqlClient.SqlClient> =>
	eff.pipe(
		Effect.catchTag('SqlError', () => Effect.die('internal database error')),
	)

export class InstructionsService extends ServiceMap.Service<InstructionsService>()(
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

				getDefaultStacks: (
					organizationId: string,
					userId: string,
					agent: Agent,
				): Effect.Effect<
					{ readonly org: StackView | null; readonly user: StackView | null },
					never,
					SqlClient.SqlClient
				> => getDefaultStacks(organizationId, userId, agent).pipe(redactSql),

				setUserStack: (
					organizationId: string,
					userId: string,
					agent: Agent,
					templateIds: ReadonlyArray<string>,
					composition: StackComposition,
				): Effect.Effect<SetStackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const result = yield* setDefaultStack({
							organizationId,
							ownerUserId: userId,
							agent,
							templateIds,
							composition,
						})
						return result.ok
							? { outcome: 'set' as const, stackId: result.stackId }
							: result.reason === 'unknown_template'
								? {
										outcome: 'unknown_template' as const,
										missing: result.missing,
									}
								: {
										outcome: 'personal_in_org_stack' as const,
										offending: result.offending,
									}
					}).pipe(redactSql),

				setOrgStack: (
					organizationId: string,
					userId: string,
					agent: Agent,
					templateIds: ReadonlyArray<string>,
				): Effect.Effect<SetStackOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						if (!(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* setDefaultStack({
							organizationId,
							ownerUserId: null,
							agent,
							templateIds,
							// The org default is always the base of any extend.
							composition: 'replace',
						})
						return result.ok
							? { outcome: 'set' as const, stackId: result.stackId }
							: result.reason === 'unknown_template'
								? {
										outcome: 'unknown_template' as const,
										missing: result.missing,
									}
								: {
										outcome: 'personal_in_org_stack' as const,
										offending: result.offending,
									}
					}).pipe(redactSql),

				clearUserStack: (
					organizationId: string,
					userId: string,
					agent: Agent,
				) =>
					clearUserDefaultStack(organizationId, userId, agent).pipe(
						Effect.orDie,
					),

				listDonations: (status?: Donation['status'] | undefined) =>
					listDonations(status).pipe(redactSql),

				propose: (
					organizationId: string,
					userId: string,
					templateId: string,
				): Effect.Effect<DonateOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						const template = yield* getTemplate(templateId)
						if (!template) return { outcome: 'not_found' as const }
						// Only a personal template you own can be donated to the org.
						if (template.ownerUserId !== userId)
							return { outcome: 'forbidden' as const }
						const donation = yield* proposeDonation({
							organizationId,
							sourceTemplateId: templateId,
							name: template.name,
							body: template.body,
							proposedBy: userId,
						})
						return { outcome: 'proposed' as const, donation }
					}).pipe(redactSql),

				accept: (
					userId: string,
					donationId: string,
				): Effect.Effect<ResolveDonationOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						if (!(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* acceptDonation(donationId, userId)
						return result.ok
							? { outcome: 'accepted' as const, template: result.template }
							: { outcome: result.reason }
					}).pipe(redactSql),

				reject: (
					userId: string,
					donationId: string,
				): Effect.Effect<ResolveDonationOutcome, never, SqlClient.SqlClient> =>
					Effect.gen(function* () {
						if (!(yield* isAdmin(userId)))
							return { outcome: 'forbidden' as const }
						const result = yield* rejectDonation(donationId, userId)
						return result === 'rejected'
							? { outcome: 'rejected' as const }
							: { outcome: result }
					}).pipe(redactSql),
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
