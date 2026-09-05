import { Effect, Ref, Schema, Stream } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import {
	BatudaApi,
	ConfirmRequired,
	CurrentOrg,
	NotFound,
	PendingPaidAction,
	PendingProposal,
	SessionContext,
	UnknownStack,
} from '@batuda/controllers'
import { resolveInstructions, resolveStackRef } from '@batuda/instructions'
import { type CreateResearchInput, ResearchService } from '@batuda/research'
import { foundRowsField } from '@batuda/research/application/schemas'
import { TimelineActivityService } from '@batuda/timeline'

import { ResearchDefaults } from '../lib/research-defaults'
import { goneFrame, liveFrame, toolFromEvent } from '../lib/research-live-frame'
import { detachFromTransaction, resolveSystemOrg } from '../middleware/org'
import { CompanyService } from '../services/companies'
import { Geocoder } from '../services/geocoder'
import {
	resolveResearchProposedUpdate,
	resolveResearchProposedUpdatesBatch,
} from '../services/research-apply'

// The pending-proposals query returns each run's `created_at` as a raw Date;
// decode it from a Date so it lands as a wire-safe DateTime.Utc, mirroring the
// PendingProposal response shape and overriding only that column.
const PendingProposalRow = Schema.Struct({
	...PendingProposal.fields,
	runCreatedAt: Schema.DateTimeUtcFromDate,
})
const decodePendingProposals = Schema.decodeUnknownEffect(
	Schema.Array(PendingProposalRow),
)

// How often a watching page is sent a frame even when the run itself has gone
// quiet. Short enough that spend and step counts keep up, and well inside the
// minute-odd a proxy will hold a connection it sees no traffic on.
const LIVE_FRAME_BEAT = '10 seconds'

// How long one connection is allowed to last before the watcher is made to open
// another. A run can last far longer than anybody's standing to see it: whoever
// opened this was checked once, when they asked, and nothing about a held-open
// connection asks again. Ending it on a timer puts the watcher back through the
// front door, where being removed from the organization actually stops them.
const LIVE_CONNECTION_LIFETIME = '2 minutes'

// A burst of events says one thing worth reading, not one per event, and the
// reading is a database round trip. Waiting for the burst to settle turns a
// tool call's pair of events — and a whole round's worth — into a single read.
const LIVE_FRAME_SETTLE = '400 millis'

// Same raw-Date handling for the waiting paid lookups.
const PendingPaidActionRow = Schema.Struct({
	...PendingPaidAction.fields,
	runCreatedAt: Schema.DateTimeUtcFromDate,
})
const decodePendingPaidActions = Schema.decodeUnknownEffect(
	Schema.Array(PendingPaidActionRow),
)

export const ResearchLive = HttpApiBuilder.group(
	BatudaApi,
	'research',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* ResearchService
			const systemDefaults = yield* ResearchDefaults
			// Applying a proposed update writes a CRM row and may fork an
			// org-scoped re-geocode; resolve those services here so both the apply
			// and reject handlers can provide them to the shared resolver.
			const companyService = yield* CompanyService
			const geocoder = yield* Geocoder
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService

			// Shared apply/reject path: run the resolver, then surface a missing run
			// as a 404 and let any DB fault die as a defect. A proposal that is no
			// longer pending is not an error — someone else already resolved it — so
			// it comes back as a plain outcome, the same way the bulk endpoint does.
			const resolveProposal = (
				id: string,
				puId: string,
				decision: 'apply' | 'reject',
				userId: string,
			) =>
				resolveResearchProposedUpdate(id, puId, decision, userId, {
					origin: 'person',
				}).pipe(
					Effect.provideService(CompanyService, companyService),
					Effect.provideService(Geocoder, geocoder),
					Effect.provideService(SqlClient.SqlClient, sql),
					Effect.provideService(TimelineActivityService, timeline),
					Effect.flatMap(result =>
						result.outcome === 'run_not_found'
							? Effect.fail(new NotFound({ entity: 'research', id }))
							: Effect.succeed(result),
					),
					Effect.catch(e =>
						e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
					),
				)

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
						// A stack picked for this run has to belong to the research
						// agent and be readable, or the run would quietly take another
						// agent's instructions (or none at all) while reporting that a
						// stack applied. Reject it before any work starts.
						const stackId = _.payload.stack_id
						if (stackId !== undefined) {
							const picked = yield* resolveStackRef('research', stackId)
							// Refused, not reported in a success body: a caller that
							// cannot tell this apart from a started run reports the run
							// as under way when nothing was ever queued.
							if (!picked.ok) return yield* new UnknownStack({ stack: stackId })
						}
						const instructions = yield* resolveInstructions({
							organizationId: currentOrg.id,
							userId,
							agent: 'research',
							overrideStackId: stackId,
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
						// A record this organization cannot see reads the same as one
						// that was never there, which is what the caller is told —
						// naming it as a different kind of refusal would say whether
						// somebody else holds that id.
						Effect.catchTag('SubjectUnavailable', e =>
							Effect.fail(
								new NotFound({
									entity: e.subjects[0]?.table ?? 'companies',
									id: e.subjects[0]?.id ?? '',
								}),
							),
						),
						Effect.catch(e =>
							e._tag === 'ConfirmRequired' ||
							e._tag === 'UnknownStack' ||
							e._tag === 'NotFound'
								? Effect.fail(e)
								: Effect.die(e),
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
							count: _.query.count,
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
				.handle('live', _ =>
					Effect.gen(function* () {
						// Which organization is watching, and which list this kind of run
						// fills with what it finds. Both are settled once: the reader was
						// checked when they asked, and a run's schema never changes.
						const currentOrg = yield* CurrentOrg
						const { userId } = yield* SessionContext
						const schemaName = yield* svc.runSchemaName(_.params.id)
						if (schemaName === undefined)
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						const foundField = foundRowsField(schemaName)

						// What the run last reached for. Held here because the row does not
						// keep it; it is only ever said once, in the event announcing the
						// call, and taken back when that call returns.
						const activeTool = yield* Ref.make<string | null>(null)

						// Reading the run again happens after this handler has returned:
						// the frames are sent as the body streams, and the transaction that
						// carried the reader's organization committed the moment the handler
						// handed the stream back. So each read re-enters that same
						// organization by hand, on a connection of its own. Without it the
						// read would run with no organization set at all, which is not a
						// quiet no-op — it is the shape of a cross-tenant read.
						//
						// A run that reads back as nothing is one this watcher may no longer
						// see — deleted while they watched, most often. That is an ending,
						// not a hiccup, and is told apart from a read that simply failed:
						// without the distinction a deleted run left the connection open
						// forever, re-reading a row it would never see again.
						// `reenter` is the whole difference between the opening read and
						// every later one. The opening happens inside the request, which
						// holds the reader's organization already; re-entering there would
						// look it up a second time and read from outside the transaction it
						// belongs to.
						const readRow = (reenter: boolean) => {
							const read = svc.liveSnapshot(_.params.id, foundField)
							return reenter
								? read.pipe(
										resolveSystemOrg(sql, currentOrg.id, { userId }),
										detachFromTransaction(sql),
									)
								: read
						}

						const readFrame = Effect.gen(function* () {
							const row = yield* readRow(true)
							return row === null
								? null
								: liveFrame(row, yield* Ref.get(activeTool))
						})

						const openingRow = yield* readRow(false)
						const opening =
							openingRow === null ? null : liveFrame(openingRow, null)
						// Gone between the two reads, or over already: either way there is
						// nothing left to watch, so say so once and close. Holding the
						// connection open would leave the page waiting on a run that will
						// never send anything again.
						if (opening === null)
							return yield* new NotFound({
								entity: 'research',
								id: _.params.id,
							})
						if (opening.done) return Stream.make(opening)

						const nextFrame = readFrame.pipe(
							Effect.map(frame => frame ?? goneFrame(opening)),
							// A read that fails mid-run must not tear down a watcher's page;
							// the next beat tries again.
							Effect.catchCause(() => Effect.succeed(null)),
						)

						// Two things ask for a frame. The run's own events ask the instant
						// something happens, which is what makes the page live. The beat
						// asks anyway, which covers a run that has not started publishing
						// yet and spend that climbs between events.
						const events = yield* svc.subscribe(_.params.id)
						// `tick` beats once straight away, and the opening frame above
						// has already said everything that beat would; dropping it saves
						// a second read of the same row a moment later.
						const beat = Stream.drop(Stream.tick(LIVE_FRAME_BEAT), 1)
						// An event's payload goes no further than the tool it may name —
						// the one thing the row does not keep. Everything else is read off
						// the row afterwards, so each event becomes a bare nudge of the
						// same shape the beat has.
						const asks =
							events === null
								? beat
								: Stream.merge(
										beat,
										Stream.mapEffect(events, event => {
											const named = toolFromEvent(event)
											return named === null
												? Effect.void
												: Ref.set(activeTool, named.tool)
										}),
									)

						return Stream.make(opening).pipe(
							Stream.concat(
								asks.pipe(
									// A round fires several events at once and they say one thing
									// between them; reading the row per event was the same answer
									// fetched several times over.
									Stream.debounce(LIVE_FRAME_SETTLE),
									Stream.mapEffect(() => nextFrame),
									Stream.filter(frame => frame !== null),
								),
							),
							// The last frame a watcher gets is the one saying it is over, so
							// the page lands on the run's real ending rather than on whatever
							// it happened to be showing when the connection dropped.
							Stream.takeUntil(frame => frame.done),
							// And the connection does not outlive the standing of whoever
							// opened it — see LIVE_CONNECTION_LIFETIME. Ending it without a
							// finishing frame is the signal to open another.
							Stream.haltWhen(Effect.sleep(LIVE_CONNECTION_LIFETIME)),
						)
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
						// A run that has already finished cannot be cancelled, so pass the
						// real outcome through instead of always claiming a cancellation.
						return { outcome: res.outcome }
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
						// An action someone already decided, or one naming a lookup that
						// does not exist, spends nothing and changes nothing — the caller
						// has to tell that apart from a real approval.
						return {
							outcome: result.status,
							...(result.status === 'approved'
								? { followupRunId: result.followup_run_id }
								: {}),
						}
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
						return { outcome: result.status }
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
						// The run being re-run may still name a record this organization
						// cannot see, and that reads as a missing record here the same
						// way it does when a run is first created.
						Effect.catchTag('SubjectUnavailable', e =>
							Effect.fail(
								new NotFound({
									entity: e.subjects[0]?.table ?? 'companies',
									id: e.subjects[0]?.id ?? '',
								}),
							),
						),
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('listPendingPaidActions', _ =>
					Effect.gen(function* () {
						// Org scope is enforced by RLS, like the run list.
						const page = yield* svc.listPendingPaidActions({
							researchId: _.query.research_id,
							limit: _.query.limit,
							offset: _.query.offset,
							count: _.query.count,
						})
						const items = yield* decodePendingPaidActions(page.items).pipe(
							Effect.orDie,
						)
						return {
							items,
							total: page.total,
							limit: page.limit,
							offset: page.offset,
							hasMore: page.hasMore,
						}
					}).pipe(Effect.orDie),
				)
				.handle('listPendingProposals', _ =>
					Effect.gen(function* () {
						// Org scope is enforced by RLS; the boolean filter arrives as a
						// query string, so map it back to a tri-state (unset = either).
						const mc = _.query.machine_checkable
						const page = yield* svc.listPendingProposals({
							subjectTable: _.query.subject_table,
							status: _.query.status,
							minConfidence: _.query.min_confidence,
							machineCheckable:
								mc === 'true' ? true : mc === 'false' ? false : undefined,
							limit: _.query.limit,
							offset: _.query.offset,
							count: _.query.count,
						})
						const items = yield* decodePendingProposals(page.items).pipe(
							Effect.orDie,
						)
						return {
							items,
							total: page.total,
							limit: page.limit,
							offset: page.offset,
							hasMore: page.hasMore,
						}
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
						const findings = (run as { findings: unknown }).findings as {
							proposed_updates?: unknown[]
						}
						// The proposals come stored with the run, so the page is cut in
						// memory. The count is free here, but it is still withheld
						// unless asked for, so this list answers in the same shape as
						// every other one.
						const proposedUpdates = findings?.proposed_updates ?? []
						const limit = _.query.limit ?? 100
						const offset = _.query.offset ?? 0
						const items = proposedUpdates.slice(offset, offset + limit)
						return {
							items,
							total: _.query.count === 'exact' ? proposedUpdates.length : null,
							limit,
							offset,
							hasMore: offset + items.length < proposedUpdates.length,
						}
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
						const org = yield* CurrentOrg
						const policy = yield* svc.getPolicy(userId, org.id)
						// No saved row yet → the effective limits are the system
						// defaults; there's no timestamp, so updatedAt is null. Same
						// shape as a decoded row so the response type stays uniform.
						return (
							policy ?? {
								budgetCents: systemDefaults.budgetCents,
								paidBudgetCents: systemDefaults.paidBudgetCents,
								autoApprovePaidCents: systemDefaults.autoApprovePaidCents,
								paidMonthlyCapCents: systemDefaults.paidMonthlyCapCents,
								autoApplyMinConfidence: null,
								updatedAt: null,
							}
						)
					}).pipe(Effect.orDie),
				)
				.handle('updatePolicy', _ =>
					Effect.gen(function* () {
						const { userId } = yield* SessionContext
						const org = yield* CurrentOrg
						return yield* svc.updatePolicy(userId, org.id, {
							budgetCents: _.payload.budget_cents,
							paidBudgetCents: _.payload.paid_budget_cents,
							autoApprovePaidCents: _.payload.auto_approve_paid_cents,
							paidMonthlyCapCents: _.payload.paid_monthly_cap_cents,
							autoApplyMinConfidence: _.payload.auto_apply_min_confidence,
						})
					}).pipe(Effect.orDie),
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
