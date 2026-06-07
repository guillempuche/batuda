import { Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BatudaApi, CurrentOrg, SessionContext } from '@batuda/controllers'
import { type Agent, AgentSchema } from '@batuda/instructions'

import { InstructionsService } from '../services/instructions'

// HTTP surface for instruction-template management. Handlers stay thin: they
// pull the active org + user, delegate to InstructionsService (which owns the
// admin gate and fork-on-edit), and return its discriminated outcome in the
// body. An unknown `agent` path segment is reported in-band rather than as a
// route 404, matching the rest of the surface.
export const InstructionsLive = HttpApiBuilder.group(
	BatudaApi,
	'instructions',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* InstructionsService
			const parseAgent = (raw: string): Agent | null =>
				Schema.is(AgentSchema)(raw) ? raw : null

			return handlers
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
				.handle('deleteTemplate', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* svc.remove(userId, _.params.id)
					}),
				)
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
				.handle('donateTemplate', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						return yield* svc.propose(org.id, userId, _.params.id)
					}),
				)
				.handle('getDefaultStacks', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						const agent = parseAgent(_.params.agent)
						if (!agent) return { error: 'unknown_agent' }
						return yield* svc.getDefaultStacks(org.id, userId, agent)
					}),
				)
				.handle('setUserStack', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						const agent = parseAgent(_.params.agent)
						if (!agent) return { error: 'unknown_agent' }
						return yield* svc.setUserStack(
							org.id,
							userId,
							agent,
							_.payload.template_ids,
							_.payload.composition ?? 'replace',
						)
					}),
				)
				.handle('clearUserStack', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						const agent = parseAgent(_.params.agent)
						if (!agent) return { error: 'unknown_agent' }
						return yield* svc.clearUserStack(org.id, userId, agent)
					}),
				)
				.handle('setOrgStack', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						const agent = parseAgent(_.params.agent)
						if (!agent) return { error: 'unknown_agent' }
						return yield* svc.setOrgStack(
							org.id,
							userId,
							agent,
							_.payload.template_ids,
						)
					}),
				)
				.handle('listPresets', _ =>
					Effect.gen(function* () {
						const requested =
							_.query.agent !== undefined ? parseAgent(_.query.agent) : null
						return yield* svc.listPresets(requested ?? undefined)
					}),
				)
				.handle('importPreset', _ =>
					Effect.gen(function* () {
						const org = yield* CurrentOrg
						const { userId } = yield* SessionContext
						return yield* svc.importPreset(
							org.id,
							userId,
							_.params.presetId,
							_.payload.scope,
						)
					}),
				)
				.handle('listDonations', _ =>
					Effect.gen(function* () {
						const status = _.query.status
						const valid =
							status === 'pending' ||
							status === 'accepted' ||
							status === 'rejected'
								? status
								: undefined
						return yield* svc.listDonations(valid)
					}),
				)
				.handle('acceptDonation', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* svc.accept(userId, _.params.id)
					}),
				)
				.handle('rejectDonation', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* svc.reject(userId, _.params.id)
					}),
				)
		}),
)
