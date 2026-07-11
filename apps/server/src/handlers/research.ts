import { DateTime, Effect, Stream } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import {
	BatudaApi,
	ConfirmRequired,
	CurrentOrg,
	NotFound,
	SessionContext,
} from '@batuda/controllers'
import { resolveInstructions } from '@batuda/instructions'
import {
	type CreateResearchInput,
	ResearchService,
	type SystemDefaults,
} from '@batuda/research'

import { EnvVars } from '../lib/env'
import { CompanyService } from '../services/companies'
import { Geocoder } from '../services/geocoder'
import {
	resolveResearchProposedUpdate,
	resolveResearchProposedUpdatesBatch,
} from '../services/research-apply'
import { TimelineActivityService } from '../services/timeline-activity'

export const ResearchLive = HttpApiBuilder.group(
	BatudaApi,
	'research',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const env = yield* EnvVars
			// Applying a proposed update writes a CRM row and may fork an
			// org-scoped re-geocode; resolve those services here so both the apply
			// and reject handlers can provide them to the shared resolver.
			const companyService = yield* CompanyService
			const geocoder = yield* Geocoder
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService

			// Shared apply/reject path: run the resolver, then surface a missing run
			// or proposal as a 404 and let any DB fault die as a defect.
			const resolveProposal = (
				id: string,
				puId: string,
				decision: 'apply' | 'reject',
				userId: string,
			) =>
				resolveResearchProposedUpdate(id, puId, decision, userId).pipe(
					Effect.provideService(CompanyService, companyService),
					Effect.provideService(Geocoder, geocoder),
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.provideService(TimelineActivityService, timeline),
					Effect.flatMap(result =>
						result.outcome === 'run_not_found'
							? Effect.fail(new NotFound({ entity: 'research', id }))
							: result.outcome === 'proposal_not_found'
								? Effect.fail(
										new NotFound({ entity: 'proposed-update', id: puId }),
									)
								: Effect.succeed(result),
					),
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				)

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
						const instructions = yield* resolveInstructions({
							organizationId: currentOrg.id,
							userId,
							agent: 'research',
							overrideTemplateIds: _.payload.template_ids,
						})
						const result = yield* svc.create(
							userId,
							currentOrg.id,
							input,
							systemDefaults,
							instructions,
						)
						// A selector fan-out the caller hasn't confirmed comes back as
						// a cost estimate; surface it as the 409 the create contract
						// declares so the caller can re-submit with `confirm: true`.
						if (result.status === 'confirm_required') {
							return yield* new ConfirmRequired({
								estimatedCostCents: result.estimatedCostCents,
								subjectCount: result.subjectCount,
							})
						}
						return result
					}).pipe(
						Effect.catch(e =>
							e._tag === 'ConfirmRequired' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('list', _ =>
					Effect.gen(function* () {
						// Org-scope is enforced by RLS — `created_by` stays
						// opt-in so a per-company query returns every
						// teammate's run, not just the caller's.
						return yield* svc.list({
							createdBy: _.query.created_by,
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
							[
								'succeeded',
								'failed',
								'cancelled',
								'deleted',
								'no_reliable_data',
							].includes(status)
						) {
							return {
								status,
								events: [
									{
										type: `run.${status}`,
										researchId: _.params.id,
										timestamp:
											(run as { completedAt: string | null }).completedAt ??
											DateTime.formatIso(DateTime.nowUnsafe()),
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
									evt.type === 'run.cancelled' ||
									evt.type === 'run.no_reliable_data',
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
								[
									'run.succeeded',
									'run.failed',
									'run.cancelled',
									'run.no_reliable_data',
								].includes((e as { type: string }).type),
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
						const res = yield* svc.cancel(_.params.id)
						if (res.outcome === 'not_found')
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						return { status: 'cancelled' }
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('attach', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const res = yield* svc.attach(
							currentOrg.id,
							_.params.id,
							_.payload.subject_table,
							_.payload.subject_id,
						)
						if (res.outcome === 'subject_not_found')
							return yield* new NotFound({
								entity: _.payload.subject_table,
								id: _.payload.subject_id,
							})
						if (res.outcome === 'run_not_found')
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						return { status: 'attached' }
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
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
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						const result = yield* svc.approvePaidAction(
							_.params.id,
							_.params.paId,
							userId,
						)
						if (
							result.status === 'run_not_found' ||
							result.status === 'action_not_found'
						)
							return yield* Effect.fail(
								new NotFound({ entity: 'research', id: _.params.id }),
							)
						return result
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('skipPaidAction', _ =>
					Effect.gen(function* () {
						const result = yield* svc.skipPaidAction(_.params.id, _.params.paId)
						if (
							result.status === 'run_not_found' ||
							result.status === 'action_not_found'
						)
							return yield* Effect.fail(
								new NotFound({ entity: 'research', id: _.params.id }),
							)
						return result
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('rerun', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						const currentOrg = yield* CurrentOrg
						const result = yield* svc.rerun(
							userId,
							currentOrg.id,
							_.params.id,
							_.payload.domain,
						)
						if (result.status === 'run_not_found')
							return yield* Effect.fail(
								new NotFound({ entity: 'research', id: _.params.id }),
							)
						return result
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('listPendingProposals', _ =>
					Effect.gen(function* () {
						// Org scope is enforced by RLS; the boolean filter arrives as a
						// query string, so map it back to a tri-state (unset = either).
						const mc = _.query.machine_checkable
						return yield* svc.listPendingProposals({
							subjectTable: _.query.subject_table,
							status: _.query.status,
							minConfidence: _.query.min_confidence,
							machineCheckable:
								mc === 'true' ? true : mc === 'false' ? false : undefined,
							limit: _.query.limit,
							offset: _.query.offset,
						})
					}).pipe(Effect.orDie),
				)
				.handle('listProposedUpdates', _ =>
					Effect.gen(function* () {
						const run = yield* svc.get(_.params.id)
						if (!run)
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						// The SQL client camelCases JSONB keys on read, so the stored
						// `proposed_updates` surfaces here as `proposedUpdates`.
						const findings = (run as { findings: unknown }).findings as {
							proposedUpdates?: unknown[]
						}
						return findings?.proposedUpdates ?? []
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('applyProposedUpdate', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* resolveProposal(
							_.params.id,
							_.params.puId,
							'apply',
							userId,
						)
					}),
				)
				.handle('rejectProposedUpdate', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						return yield* resolveProposal(
							_.params.id,
							_.params.puId,
							'reject',
							userId,
						)
					}),
				)
				.handle('resolveProposedUpdatesBatch', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						const results = yield* resolveResearchProposedUpdatesBatch(
							_.payload.items.map(i => ({
								researchId: i.research_id,
								proposedUpdateId: i.proposed_update_id,
								decision: i.decision,
							})),
							userId,
						).pipe(
							Effect.provideService(CompanyService, companyService),
							Effect.provideService(Geocoder, geocoder),
							Effect.provideService(SqlClient.SqlClient, sql),
							Effect.provideService(TimelineActivityService, timeline),
						)
						return { results }
					}).pipe(Effect.orDie),
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
								auto_apply_min_confidence: null,
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
							autoApplyMinConfidence: _.payload.auto_apply_min_confidence,
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
