import { Effect, Stream } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import {
	BatudaApi,
	CurrentOrg,
	NotFound,
	SessionContext,
} from '@batuda/controllers'
import {
	type CreateResearchInput,
	ResearchService,
	type SystemDefaults,
} from '@batuda/research'

import { EnvVars } from '../lib/env'

export const ResearchLive = HttpApiBuilder.group(
	BatudaApi,
	'research',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const env = yield* EnvVars

			const systemDefaults: SystemDefaults = {
				budgetCents: env.RESEARCH_DEFAULT_BUDGET_CENTS,
				paidBudgetCents: env.RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
				autoApprovePaidCents: env.RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
				paidMonthlyCapCents: env.RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
				hardCeiling: env.RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
			}

			return handlers
				.handle('create', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						const currentOrg = yield* CurrentOrg
						const input: CreateResearchInput = {
							query: _.payload.query,
							mode: _.payload.mode,
							context: _.payload.context as CreateResearchInput['context'],
							schemaName: _.payload.schema_name,
							budgetCents: _.payload.budget_cents,
							paidBudgetCents: _.payload.paid_budget_cents,
							autoApprovePaidCents: _.payload.auto_approve_paid_cents,
							confirm: _.payload.confirm,
						}
						return yield* svc.create(
							userId,
							currentOrg.id,
							input,
							systemDefaults,
						)
					}).pipe(Effect.orDie),
				)
				.handle('list', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* svc.list({
							createdBy: _.query.created_by ?? userId,
							status: _.query.status,
							subjectTable: _.query.subject_table,
							subjectId: _.query.subject_id,
							since: _.query.since,
							limit: _.query.limit,
							offset: _.query.offset,
						})
					}).pipe(Effect.orDie),
				)
				.handle('get', _ =>
					Effect.gen(function* () {
						const run = yield* svc.get(_.params.id)
						if (!run)
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						return run
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('events', _ =>
					Effect.gen(function* () {
						// Check the run exists
						const run = yield* svc.get(_.params.id)
						if (!run)
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})

						const status = (run as { status: string }).status

						// If already terminal, return final state immediately
						if (
							['succeeded', 'failed', 'cancelled', 'deleted'].includes(status)
						) {
							return {
								status,
								events: [
									{
										type: `run.${status}`,
										researchId: _.params.id,
										timestamp:
											(run as { completedAt: string | null }).completedAt ??
											new Date().toISOString(),
										data: {},
									},
								],
								done: true,
							}
						}

						// Long-poll: subscribe and collect events for up to 30s
						const stream = yield* svc.subscribe(_.params.id)
						if (!stream) {
							// No active PubSub — run may have completed between check and subscribe
							return { status, events: [], done: false }
						}

						const events: unknown[] = []
						yield* stream.pipe(
							Stream.takeUntil(
								evt =>
									evt.type === 'run.succeeded' ||
									evt.type === 'run.failed' ||
									evt.type === 'run.cancelled',
							),
							Stream.tap(evt =>
								Effect.sync(() => {
									events.push(evt)
								}),
							),
							Stream.runDrain,
							Effect.timeout('30 seconds'),
							Effect.catch(() => Effect.void),
						)

						return {
							status:
								events.length > 0
									? (
											events[events.length - 1] as { type: string }
										).type.replace('run.', '')
									: status,
							events,
							done: events.some(e =>
								['run.succeeded', 'run.failed', 'run.cancelled'].includes(
									(e as { type: string }).type,
								),
							),
						}
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('cancel', _ =>
					Effect.gen(function* () {
						yield* svc.cancel(_.params.id)
						return { status: 'cancelled' }
					}).pipe(Effect.orDie),
				)
				.handle('attach', _ =>
					Effect.gen(function* () {
						yield* svc.attach(
							_.params.id,
							_.payload.subject_table,
							_.payload.subject_id,
						)
						return { status: 'attached' }
					}).pipe(Effect.orDie),
				)
				.handle('delete', _ =>
					Effect.gen(function* () {
						yield* svc.softDelete(_.params.id)
						return { status: 'deleted' }
					}).pipe(Effect.orDie),
				)
				.handle('bySubject', _ =>
					svc.bySubject(_.params.table, _.params.subjectId).pipe(Effect.orDie),
				)
				.handle('approvePaidAction', _ =>
					// Follow-up run mechanic — creates a new
					// kind='followup' run with the approved action.
					// Placeholder for now.
					Effect.succeed({
						status: 'approved',
						followup_run_id: null,
					}),
				)
				.handle('skipPaidAction', _ =>
					Effect.succeed({
						status: 'skipped',
					}),
				)
				.handle('listProposedUpdates', _ =>
					Effect.gen(function* () {
						const run = yield* svc.get(_.params.id)
						if (!run)
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						const findings = (run as { findings: unknown }).findings as {
							proposed_updates?: unknown[]
						}
						return findings?.proposed_updates ?? []
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('applyProposedUpdate', _ =>
					// Fires the domain update endpoint with OCC.
					// Placeholder for now.
					Effect.succeed({ status: 'applied' }),
				)
				.handle('rejectProposedUpdate', _ =>
					Effect.succeed({ status: 'rejected' }),
				)
				.handle('getPolicy', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						const policy = yield* svc.getPolicy(userId)
						return (
							policy ?? {
								budget_cents: systemDefaults.budgetCents,
								paid_budget_cents: systemDefaults.paidBudgetCents,
								auto_approve_paid_cents: systemDefaults.autoApprovePaidCents,
								paid_monthly_cap_cents: systemDefaults.paidMonthlyCapCents,
							}
						)
					}).pipe(Effect.orDie),
				)
				.handle('updatePolicy', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* svc.updatePolicy(userId, {
							budgetCents: _.payload.budget_cents,
							paidBudgetCents: _.payload.paid_budget_cents,
							autoApprovePaidCents: _.payload.auto_approve_paid_cents,
							paidMonthlyCapCents: _.payload.paid_monthly_cap_cents,
						})
					}).pipe(
						Effect.map(rows => rows[0]),
						Effect.orDie,
					),
				)
				.handle('spend', _ =>
					svc
						.spend({
							range: narrowRange(_.query.range),
							groupBy: narrowGroupBy(_.query.groupBy),
						})
						.pipe(Effect.orDie),
				)
		}),
)

function narrowRange(value: string | undefined): 'month' | '30d' | 'all' {
	return value === 'month' || value === '30d' ? value : 'all'
}

function narrowGroupBy(
	value: string | undefined,
): 'provider' | 'user' | 'tool' {
	return value === 'user' || value === 'tool' ? value : 'provider'
}
