import { Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, CurrentOrg, SessionContext } from '@batuda/controllers'
import {
	type Agent,
	AgentSchema,
	resolveInstructions,
} from '@batuda/instructions'

import { InstructionsService } from '../services/instructions'

// HTTP surface for instruction-template management. Handlers stay thin: they
// pull the active org + user, delegate to InstructionsService (which owns the
// admin gate on the organization's stacks), and return its discriminated
// outcome in the body. An unknown `agent` path segment is reported in-band
// rather than as a route 404, matching the rest of the surface.
export const InstructionsLive = HttpApiBuilder.group(
	BatudaApi,
	'instructions',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* InstructionsService
			const parseAgent = (raw: string): Agent | null =>
				Schema.is(AgentSchema)(raw) ? raw : null

			return (
				handlers
					.handle('listTemplates', () => svc.listTemplates())
					.handle('createTemplate', _ =>
						Effect.gen(function* () {
							const org = yield* CurrentOrg
							const { userId } = yield* SessionContext
							return yield* svc.create(org.id, userId, {
								name: _.payload.name,
								body: _.payload.body,
								scope: _.payload.scope,
							})
						}),
					)
					.handle('getTemplate', _ =>
						Effect.gen(function* () {
							const template = yield* svc.getTemplate(_.params.id)
							return template ?? { error: 'not_found' }
						}),
					)
					.handle('updateTemplate', _ =>
						Effect.gen(function* () {
							const { userId } = yield* SessionContext
							return yield* svc.update(userId, _.params.id, {
								name: _.payload.name,
								body: _.payload.body,
							})
						}),
					)
					.handle('deleteTemplate', _ => svc.remove(_.params.id))
					.handle('transferTemplate', _ =>
						Effect.gen(function* () {
							const org = yield* CurrentOrg
							const { userId } = yield* SessionContext
							return yield* svc.transfer(
								org.id,
								userId,
								_.params.id,
								_.payload.target_user_id,
							)
						}),
					)
					.handle('listStacks', _ =>
						Effect.gen(function* () {
							const raw = _.query.agent
							// An explicit but unknown agent filter returns the valid set
							// rather than silently listing everything.
							if (raw !== undefined && parseAgent(raw) === null)
								return { error: 'unknown_agent' }
							const items = yield* svc.listStacks(
								raw === undefined ? undefined : (raw as Agent),
							)
							return { items }
						}),
					)
					.handle('createStack', _ =>
						Effect.gen(function* () {
							const org = yield* CurrentOrg
							const { userId } = yield* SessionContext
							const agent = parseAgent(_.payload.agent)
							if (!agent) return { error: 'unknown_agent' }
							return yield* svc.createStack(org.id, userId, {
								scope: _.payload.scope,
								agent,
								name: _.payload.name,
								templateIds: _.payload.template_ids,
								composition: _.payload.composition,
								isDefault: _.payload.is_default ?? false,
							})
						}),
					)
					.handle('getStack', _ =>
						Effect.gen(function* () {
							const stack = yield* svc.getStack(_.params.id)
							return stack ?? { error: 'not_found' }
						}),
					)
					.handle('updateStack', _ =>
						Effect.gen(function* () {
							const { userId } = yield* SessionContext
							return yield* svc.updateStack(userId, _.params.id, {
								name: _.payload.name,
								templateIds: _.payload.template_ids,
								composition: _.payload.composition,
							})
						}),
					)
					.handle('deleteStack', _ =>
						Effect.gen(function* () {
							const { userId } = yield* SessionContext
							return yield* svc.deleteStack(userId, _.params.id)
						}),
					)
					.handle('setDefaultStack', _ =>
						Effect.gen(function* () {
							const { userId } = yield* SessionContext
							return yield* svc.setDefault(userId, _.params.id)
						}),
					)
					.handle('clearDefaultStack', _ =>
						Effect.gen(function* () {
							const org = yield* CurrentOrg
							const { userId } = yield* SessionContext
							const agent = parseAgent(_.params.agent)
							if (!agent) return { error: 'unknown_agent' }
							return yield* svc.clearDefault(
								org.id,
								userId,
								agent,
								_.query.scope ?? 'personal',
							)
						}),
					)
					// The instructions that fire today with no per-run override, plus the
					// default stacks per scope — the UI's "what's active" view.
					.handle('getResolution', _ =>
						Effect.gen(function* () {
							const org = yield* CurrentOrg
							const { userId } = yield* SessionContext
							const agent = parseAgent(_.params.agent)
							if (!agent) return { error: 'unknown_agent' }
							const active = yield* resolveInstructions({
								organizationId: org.id,
								userId,
								agent,
							}).pipe(Effect.orDie)
							const defaults = yield* svc.getDefaultStacks(
								org.id,
								userId,
								agent,
							)
							return {
								source: active.source,
								template_names: active.templateNames,
								segments: active.segments,
								defaults,
							}
						}),
					)
			)
		}),
)
