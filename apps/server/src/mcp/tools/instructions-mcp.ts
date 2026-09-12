import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import type { SqlError } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, SessionContext } from '@batuda/controllers'
import {
	type Agent,
	AgentSchema,
	resolveInstructionRefs,
	resolveStackRef,
} from '@batuda/instructions'

import { InstructionsService } from '../../services/instructions'
import {
	buildClarification,
	buildStackClarification,
} from './_instructions-shared'
import { Uuid } from './_research-shared'
import { toItems } from './_result'

// One consolidated, action-based tool for the whole instruction surface —
// templates (reusable prompt blocks) and named stacks (ordered lists of
// templates per agent). Each acts as the attributed user; org-owned stack
// writes are admin-gated inside InstructionsService, while templates are open
// to any member, and every outcome (including admin / validation rejections and
// unresolved refs) comes back in the result body.

const REQUEST_DEPENDENCIES = [SessionContext, CurrentOrg]
const Scope = Schema.Literals(['personal', 'org'])

const ManageInstructions = Tool.make('manage_instructions', {
	description:
		'Manage instruction templates and named instruction stacks for the active org. Templates are reusable blocks of prompt text; stacks are named, ordered lists of templates per agent (research, email), with at most one default per scope. scope=org targets org-owned rows; scope=personal targets your own. Any member may create, edit or delete a template in either scope, and an edit to an org template changes it for everyone; org-owned *stacks* are admin-only. transfer_template hands a personal template you own to another member. `stack` accepts a stack name or id and `templates` accepts template names or ids — an unknown or ambiguous ref returns {_tag:"instruction_clarification"} with candidates instead of acting. A personal stack with composition=extend layers its templates on the live org default. set_default_stack makes a stack the default for its agent and scope; clear_default_stack unsets the default (personal: you inherit the org default; org, admin-only: the agent runs with no org default). An org research stack also declares *attributes* — the facts this organisation records on every company it researches with that stack, at most 8 active per stack: list_attributes (any member; optionally one `stack` or one `agent`), create_attribute (admin; `stack` + `agent` name the org research stack, plus `key`, `label`, `kind` and, for a choice, `enum_values`), update_attribute and delete_attribute (admin; `id` is the attribute id — the key never changes, a retired one is set is_active=false, deleting keeps the values companies already carry). A key is lowercase letters, digits and underscores starting with a letter, and not a name a research run already uses for a field; the kinds are text, number, enum, boolean, date. A refusal comes back as {outcome} with a code: duplicate_key, too_many_active, invalid_key, reserved_key, label_required, label_too_long, label_not_one_line, unknown_kind, enum_values_required, enum_values_not_allowed, enum_value_invalid, unit_too_long, description_too_long, kind_mismatch (the same key on another stack of this org reads differently, retired ones included — match it or pick another key), key_in_use (companies already hold values under the key, so its kind, unit and words stay as they are — retire it and declare a new key), agent_not_research, stack_not_org, unknown_stack, forbidden, not_found. Set research_fills_attributes=true on the org research stack (create_stack / update_stack, admin) to let runs fill its attributes; until then declaring an attribute changes nothing a run does.',
	parameters: Schema.Struct({
		action: Schema.Literals([
			'list_templates',
			'get_template',
			'create_template',
			'update_template',
			'delete_template',
			'transfer_template',
			'list_stacks',
			'get_stack',
			'create_stack',
			'update_stack',
			'delete_stack',
			'set_default_stack',
			'clear_default_stack',
			'list_attributes',
			'create_attribute',
			'update_attribute',
			'delete_attribute',
		]),
		// A template id (for the *_template actions) or an attribute id (for
		// update_attribute / delete_attribute).
		id: Schema.optionalKey(Uuid),
		// A stack name or id (for the *_stack actions that target one stack).
		stack: Schema.optionalKey(Schema.String),
		agent: Schema.optionalKey(Schema.String),
		scope: Schema.optionalKey(Scope),
		name: Schema.optionalKey(Schema.String),
		body: Schema.optionalKey(Schema.String),
		// Template names or ids that make up a stack.
		templates: Schema.optionalKey(Schema.Array(Schema.String)),
		composition: Schema.optionalKey(Schema.Literals(['replace', 'extend'])),
		is_default: Schema.optionalKey(Schema.Boolean),
		// Org research stacks only: whether a run fills the stack's attributes.
		research_fills_attributes: Schema.optionalKey(Schema.Boolean),
		target_user_id: Schema.optionalKey(Schema.String),
		// An attribute declaration (for the *_attribute actions).
		key: Schema.optionalKey(Schema.String),
		label: Schema.optionalKey(Schema.String),
		kind: Schema.optionalKey(Schema.String),
		enum_values: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
		unit: Schema.optionalKey(Schema.NullOr(Schema.String)),
		description: Schema.optionalKey(Schema.NullOr(Schema.String)),
		is_active: Schema.optionalKey(Schema.Boolean),
	}),
	success: Schema.Unknown,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Manage Instructions')
	.annotate(Tool.OpenWorld, false)

export const InstructionsMcpTools = Toolkit.make(ManageInstructions)

export const InstructionsMcpHandlersLive = InstructionsMcpTools.toLayer(
	Effect.gen(function* () {
		const svc = yield* InstructionsService
		const sql = yield* SqlClient.SqlClient
		// The service methods already redact SQL faults; provide the captured
		// client so the per-call handler requirement stays clean.
		const run = <A>(eff: Effect.Effect<A, never, SqlClient.SqlClient>) =>
			eff.pipe(Effect.provideService(SqlClient.SqlClient, sql))
		// Ref resolution keeps SqlError in its channel; a fault there is a defect,
		// not a caller error, so die rather than leak it.
		const runRefs = <A>(
			eff: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
		) => eff.pipe(Effect.orDie, Effect.provideService(SqlClient.SqlClient, sql))
		const parseAgent = (raw: string): Agent | null =>
			Schema.is(AgentSchema)(raw) ? raw : null
		// A stack name must carry at least one visible character. The database
		// enforces this too, but a constraint failure surfaces as an opaque
		// internal error the caller can't act on — so say what's wrong here.
		const isBlank = (value: string) => value.trim().length === 0

		return {
			manage_instructions: params =>
				Effect.gen(function* () {
					const org = yield* CurrentOrg
					const { userId } = yield* SessionContext

					switch (params.action) {
						// ── Templates ──────────────────────────────────────────────
						case 'list_templates':
							// Wrap the row list in an object — a bare array is not valid
							// MCP structured output and strict clients reject it.
							return toItems(yield* run(svc.listTemplates()))
						case 'get_template':
							if (params.id === undefined)
								return { error: 'id is required to get a template' }
							return (
								(yield* run(svc.getTemplate(params.id))) ?? {
									error: 'not_found',
								}
							)
						case 'create_template':
							if (params.name === undefined || params.body === undefined)
								return { error: 'name and body are required to create' }
							return yield* run(
								svc.create(org.id, userId, {
									name: params.name,
									body: params.body,
									scope: params.scope ?? 'personal',
								}),
							)
						case 'update_template':
							if (params.id === undefined)
								return { error: 'id is required to update' }
							return yield* run(
								svc.update(userId, params.id, {
									name: params.name,
									body: params.body,
								}),
							)
						case 'delete_template':
							if (params.id === undefined)
								return { error: 'id is required to delete' }
							return yield* run(svc.remove(params.id))
						case 'transfer_template':
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

						// ── Stacks ─────────────────────────────────────────────────
						case 'list_stacks': {
							const agent =
								params.agent === undefined
									? undefined
									: parseAgent(params.agent)
							if (params.agent !== undefined && agent === null)
								return { error: 'unknown agent' }
							return toItems(yield* run(svc.listStacks(agent ?? undefined)))
						}
						case 'get_stack':
						case 'update_stack':
						case 'delete_stack':
						case 'set_default_stack': {
							if (params.stack === undefined || params.agent === undefined)
								return { error: 'stack and agent are required' }
							const agent = parseAgent(params.agent)
							if (!agent) return { error: 'unknown agent' }
							const refResult = yield* runRefs(
								resolveStackRef(agent, params.stack),
							)
							if (!refResult.ok) return buildStackClarification(refResult)
							const stackId = refResult.stackId
							if (params.action === 'get_stack')
								return (
									(yield* run(svc.getStack(stackId))) ?? {
										error: 'not_found',
									}
								)
							if (params.action === 'delete_stack')
								return yield* run(svc.deleteStack(userId, stackId))
							if (params.action === 'set_default_stack')
								return yield* run(svc.setDefault(userId, stackId))
							// update_stack: resolve any template refs before writing.
							if (params.name !== undefined && isBlank(params.name))
								return { error: 'name cannot be blank' }
							const refs = params.templates
							let templateIds: ReadonlyArray<string> | undefined
							if (refs !== undefined) {
								const resolved = yield* runRefs(resolveInstructionRefs(refs))
								if (!resolved.ok) return buildClarification(resolved)
								templateIds = resolved.templateIds
							}
							return yield* run(
								svc.updateStack(userId, stackId, {
									name: params.name,
									templateIds,
									composition: params.composition,
									researchFillsAttributes: params.research_fills_attributes,
								}),
							)
						}
						case 'create_stack': {
							if (params.agent === undefined || params.name === undefined)
								return { error: 'agent and name are required to create' }
							if (isBlank(params.name)) return { error: 'name cannot be blank' }
							const agent = parseAgent(params.agent)
							if (!agent) return { error: 'unknown agent' }
							const resolved = yield* runRefs(
								resolveInstructionRefs(params.templates ?? []),
							)
							if (!resolved.ok) return buildClarification(resolved)
							return yield* run(
								svc.createStack(org.id, userId, {
									scope: params.scope ?? 'personal',
									agent,
									name: params.name,
									templateIds: resolved.templateIds,
									composition: params.composition,
									isDefault: params.is_default ?? false,
									researchFillsAttributes: params.research_fills_attributes,
								}),
							)
						}
						case 'clear_default_stack': {
							if (params.agent === undefined)
								return { error: 'agent is required' }
							const agent = parseAgent(params.agent)
							if (!agent) return { error: 'unknown agent' }
							return yield* run(
								svc.clearDefault(
									org.id,
									userId,
									agent,
									params.scope ?? 'personal',
								),
							)
						}

						// ── Attributes ─────────────────────────────────────────────
						case 'list_attributes': {
							const agent =
								params.agent === undefined
									? undefined
									: parseAgent(params.agent)
							if (params.agent !== undefined && agent === null)
								return { error: 'unknown agent' }
							let stackId: string | undefined
							if (params.stack !== undefined) {
								if (!agent)
									return { error: 'agent is required to name a stack' }
								const refResult = yield* runRefs(
									resolveStackRef(agent, params.stack),
								)
								if (!refResult.ok) return buildStackClarification(refResult)
								stackId = refResult.stackId
							}
							return toItems(
								yield* run(
									svc.listAttributes({ stackId, agent: agent ?? undefined }),
								),
							)
						}
						case 'create_attribute': {
							if (
								params.stack === undefined ||
								params.agent === undefined ||
								params.key === undefined ||
								params.label === undefined ||
								params.kind === undefined
							)
								return {
									error:
										'stack, agent, key, label and kind are required to create an attribute',
								}
							const agent = parseAgent(params.agent)
							if (!agent) return { error: 'unknown agent' }
							const refResult = yield* runRefs(
								resolveStackRef(agent, params.stack),
							)
							if (!refResult.ok) return buildStackClarification(refResult)
							return yield* run(
								svc.createAttribute(userId, {
									stackId: refResult.stackId,
									key: params.key,
									label: params.label,
									kind: params.kind,
									enumValues: params.enum_values ?? null,
									unit: params.unit ?? null,
									description: params.description ?? null,
								}),
							)
						}
						case 'update_attribute':
							if (params.id === undefined)
								return { error: 'id is required to update an attribute' }
							return yield* run(
								svc.updateAttribute(userId, params.id, {
									label: params.label,
									kind: params.kind,
									enumValues: params.enum_values,
									unit: params.unit,
									description: params.description,
									isActive: params.is_active,
								}),
							)
						case 'delete_attribute':
							if (params.id === undefined)
								return { error: 'id is required to delete an attribute' }
							return yield* run(svc.deleteAttribute(userId, params.id))
					}
				}),
		}
	}),
)
