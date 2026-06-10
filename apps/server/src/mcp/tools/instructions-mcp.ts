import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import { type Agent, AgentSchema } from '@batuda/instructions'

import { InstructionsService } from '../../services/instructions'
import { Uuid } from './_research-shared'

// Consolidated, action-based management tools so the MCP surface gains the
// instruction-template controls without ~16 individual tools. Each acts as the
// attributed user; scope=org writes are admin-gated inside InstructionsService.
// Outcomes (including admin/validation rejections) come back in the result body.

const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]
const Scope = Schema.Literals(['personal', 'org'])

const ManageTemplate = Tool.make('manage_instruction_template', {
	description:
		'List, create, update, delete, or transfer instruction templates for the active org. scope=org targets an org-owned template (admin only); scope=personal targets your own. Editing an org template as a non-admin forks a personal copy. transfer hands a personal template you own to another member (target_user_id).',
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'create', 'update', 'delete', 'transfer']),
		id: Schema.optional(Uuid),
		name: Schema.optional(Schema.String),
		body: Schema.optional(Schema.String),
		scope: Schema.optional(Scope),
		target_user_id: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Instruction Templates')
	.annotate(Tool.OpenWorld, false)

const ManagePreset = Tool.make('manage_instruction_preset', {
	description:
		'List the Batuda instruction-template presets, or import one into the org (admin only) or your personal library.',
	parameters: Schema.Struct({
		action: Schema.Literals(['list', 'import']),
		preset_id: Schema.optional(Schema.String),
		scope: Schema.optional(Scope),
		agent: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Instruction Presets')
	.annotate(Tool.OpenWorld, false)

const ManageDefaultStack = Tool.make('manage_instruction_default_stack', {
	description:
		'Get, set, or clear the default instruction stack for an agent. scope=org sets the org default (admin only); scope=personal sets your own; clear removes your own so you inherit the org default. composition=extend (personal scope) layers your templates on the live org default instead of replacing it.',
	parameters: Schema.Struct({
		action: Schema.Literals(['get', 'set', 'clear']),
		agent: Schema.String,
		scope: Schema.optional(Scope),
		template_ids: Schema.optional(Schema.Array(Uuid)),
		composition: Schema.optional(Schema.Literals(['replace', 'extend'])),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Instruction Default Stack')
	.annotate(Tool.OpenWorld, false)

const ManageDonation = Tool.make('manage_instruction_donation', {
	description:
		'Donate a personal instruction template to the org for shared use, or review pending donations. propose submits a personal template you own (template_id) for admin review; list returns donations (optionally filtered by status); accept (admin only) creates a fresh org template from the proposal; reject (admin only) closes it. Accepting reads only the snapshot taken when the donation was proposed, never the proposer’s still-personal template.',
	parameters: Schema.Struct({
		action: Schema.Literals(['propose', 'list', 'accept', 'reject']),
		template_id: Schema.optional(Uuid),
		id: Schema.optional(Uuid),
		status: Schema.optional(
			Schema.Literals(['pending', 'accepted', 'rejected']),
		),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Instruction Donations')
	.annotate(Tool.OpenWorld, false)

export const InstructionsMcpTools = Toolkit.make(
	ManageTemplate,
	ManagePreset,
	ManageDefaultStack,
	ManageDonation,
)

export const InstructionsMcpHandlersLive = InstructionsMcpTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* InstructionsService
		const sql = yield* SqlClient.SqlClient
		// The service methods already redact SQL faults; provide the captured
		// client so the per-call handler requirement stays clean.
		const run = <A>(eff: Effect.Effect<A, never, SqlClient.SqlClient>) =>
			eff.pipe(Effect.provideService(SqlClient.SqlClient, sql))
		const parseAgent = (raw: string): Agent | null =>
			Schema.is(AgentSchema)(raw) ? raw : null

		return {
			manage_instruction_template: params =>
				Effect.gen(function* () {
					const org = yield* CurrentOrg
					const { userId } = yield* SessionContext
					switch (params.action) {
						case 'list':
							return yield* run(svc.listTemplates())
						case 'create':
							if (
								params.name === undefined ||
								params.body === undefined ||
								params.scope === undefined
							)
								return { error: 'name, body, and scope are required to create' }
							return yield* run(
								svc.create(org.id, userId, {
									name: params.name,
									body: params.body,
									scope: params.scope,
								}),
							)
						case 'update':
							if (params.id === undefined)
								return { error: 'id is required to update' }
							return yield* run(
								svc.update(userId, params.id, {
									name: params.name,
									body: params.body,
								}),
							)
						case 'delete':
							if (params.id === undefined)
								return { error: 'id is required to delete' }
							return yield* run(svc.remove(userId, params.id))
						case 'transfer':
							if (
								params.id === undefined ||
								params.target_user_id === undefined
							)
								return {
									error: 'id and target_user_id are required to transfer',
								}
							return yield* run(
								svc.transfer(org.id, userId, params.id, params.target_user_id),
							)
					}
				}),

			manage_instruction_preset: params =>
				Effect.gen(function* () {
					const org = yield* CurrentOrg
					const { userId } = yield* SessionContext
					if (params.action === 'list') {
						const agent =
							params.agent !== undefined ? parseAgent(params.agent) : null
						return yield* run(svc.listPresets(agent ?? undefined))
					}
					if (params.preset_id === undefined || params.scope === undefined)
						return { error: 'preset_id and scope are required to import' }
					return yield* run(
						svc.importPreset(org.id, userId, params.preset_id, params.scope),
					)
				}),

			manage_instruction_default_stack: params =>
				Effect.gen(function* () {
					const org = yield* CurrentOrg
					const { userId } = yield* SessionContext
					const agent = parseAgent(params.agent)
					if (!agent) return { error: 'unknown agent' }
					switch (params.action) {
						case 'get':
							return yield* run(svc.getDefaultStacks(org.id, userId, agent))
						case 'clear':
							return yield* run(svc.clearUserStack(org.id, userId, agent))
						case 'set':
							if (params.template_ids === undefined)
								return { error: 'template_ids is required to set' }
							return yield* run(
								params.scope === 'org'
									? svc.setOrgStack(org.id, userId, agent, params.template_ids)
									: svc.setUserStack(
											org.id,
											userId,
											agent,
											params.template_ids,
											params.composition ?? 'replace',
										),
							)
					}
				}),

			manage_instruction_donation: params =>
				Effect.gen(function* () {
					const org = yield* CurrentOrg
					const { userId } = yield* SessionContext
					switch (params.action) {
						case 'list':
							return yield* run(svc.listDonations(params.status))
						case 'propose':
							if (params.template_id === undefined)
								return { error: 'template_id is required to propose' }
							return yield* run(svc.propose(org.id, userId, params.template_id))
						case 'accept':
							if (params.id === undefined)
								return { error: 'id is required to accept' }
							return yield* run(svc.accept(userId, params.id))
						case 'reject':
							if (params.id === undefined)
								return { error: 'id is required to reject' }
							return yield* run(svc.reject(userId, params.id))
					}
				}),
		}
	}),
)
