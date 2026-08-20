import { Cause, DateTime, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { ResearchEventSink } from '@batuda/research'

import { resolveSystemOrg } from '../middleware/org'
import { CompanyService } from './companies'
import { geocodeCompany } from './company-geocoding'
import { Geocoder } from './geocoder'
import { resolveResearchProposedUpdate } from './research-apply'
import { proposalsToAutoApply } from './research-auto-apply'
import {
	ResearchRunCompleted,
	TimelineActivityService,
} from './timeline-activity'
import { WebhookService } from './webhooks'

// Wire research event sink → WebhookService + TimelineActivityService
// Every ending a run reports lands on the timeline so the company activity view
// surfaces completed research alongside emails and calls — including a run that
// found nothing usable, which is a result someone still needs to hear. Cost rows
// stay in research_runs / research_paid_spend.
// Keyed by the name the sink fires, which is the run's own ending with `run.`
// swapped for `research.` — so an ending added to TERMINAL_RESEARCH_EVENTS needs
// a line here too, or runs that end that way leave no trace.
const TIMELINE_STATUS_FOR_EVENT: Record<
	string,
	| 'succeeded'
	| 'succeeded_low_confidence'
	| 'failed'
	| 'cancelled'
	| 'no_reliable_data'
	| null
> = {
	'research.succeeded': 'succeeded',
	'research.failed': 'failed',
	'research.cancelled': 'cancelled',
	'research.no_reliable_data': 'no_reliable_data',
}

// ResearchEventSink runs out-of-band of an HTTP request — research runs
// are kicked off by users but progress events fire later, sometimes from
// background fibres. Recover the org (and originating user) from the
// research_run row and enter app_user scope via resolveSystemOrg, so the
// org-scoped fan-out (webhooks, timeline) writes under RLS like a request
// instead of relying on the owner connection's bypass.
export const ResearchEventSinkLive = Layer.effect(
	ResearchEventSink,
	Effect.gen(function* () {
		const webhooks = yield* WebhookService
		const timeline = yield* TimelineActivityService
		const sql = yield* SqlClient.SqlClient
		const companyService = yield* CompanyService
		const geocoder = yield* Geocoder
		return ResearchEventSink.of({
			fire: (event, payload) =>
				Effect.gen(function* () {
					const researchId = (payload as { researchId?: string }).researchId
					if (!researchId) {
						yield* Effect.logWarning(
							'ResearchEventSink.fire called without researchId in payload',
						)
						return
					}
					const rows = yield* sql<{
						organizationId: string
						createdBy: string | null
						query: string
						briefMd: string | null
						schemaName: string | null
						status: string
						paidPolicy: { autoApplyMinConfidence?: number | null } | null
					}>`
						SELECT organization_id, created_by, query, brief_md, schema_name,
							status, paid_policy
						FROM research_runs
						WHERE id = ${researchId} LIMIT 1
					`
					const [run] = rows
					if (!run) return
					// A run that needs reading ends on the same event as any other
					// success, so the company's own history would record it as clean.
					// The row itself says which it was, and that is what a person
					// scrolling back months later has to see.
					const mapped = TIMELINE_STATUS_FOR_EVENT[event] ?? null
					const status =
						mapped === 'succeeded' && run.status === 'succeeded_low_confidence'
							? 'succeeded_low_confidence'
							: mapped

					// Fan out as the system actor: load the real org and enter
					// app_user scope so the timeline write passes RLS like a
					// request would, instead of leaning on the owner connection's
					// bypass. webhooks.fire forks its own delivery, so it rides
					// CurrentOrg (now a real name/slug) but escapes the per-tx GUC.
					yield* resolveSystemOrg(sql, run.organizationId, {
						userId: run.createdBy ?? undefined,
					})(
						Effect.gen(function* () {
							yield* webhooks.fire(event, payload)
							if (!status) return
							const linkRows = yield* sql<{
								subjectId: string
								location: string | null
								needsCoords: boolean | null
							}>`
								SELECT rl.subject_id, c.location, (c.latitude IS NULL) AS needs_coords
								FROM research_links rl
								LEFT JOIN companies c
									ON c.id = rl.subject_id
									AND c.organization_id = ${run.organizationId}
								WHERE rl.research_id = ${researchId}
								  AND rl.subject_table = 'companies'
								  AND rl.link_kind = 'input'
								LIMIT 1
							`
							const linked = linkRows[0]
							yield* timeline.record(
								new ResearchRunCompleted({
									researchRunId: researchId,
									companyId: linked?.subjectId ?? null,
									summary: run.briefMd ?? run.query,
									status,
									// The actor is whoever asked for the run, not the background
									// worker that finished it.
									actorUserId: run.createdBy ?? null,
									occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
								}),
							)

							// An enrichment run no longer asks the model for coordinates,
							// so resolve them the deterministic way here: when the run
							// succeeded for a linked company that has a written location
							// but no coordinates yet, look the location up in the geocoder
							// and store lat/long. Best-effort — a miss or failure must
							// never disturb the timeline and webhook fan-out above.
							if (
								status === 'succeeded' &&
								run.schemaName === 'company_enrichment_v1' &&
								linked?.location &&
								linked.needsCoords
							) {
								yield* geocodeCompany(linked.subjectId).pipe(
									Effect.provideService(CompanyService, companyService),
									Effect.provideService(Geocoder, geocoder),
									Effect.catchCause(cause =>
										Effect.logWarning('post-enrichment geocode failed').pipe(
											Effect.annotateLogs({
												event: 'research.geocode.failed',
												companyId: linked.subjectId,
												cause: Cause.pretty(cause),
											}),
										),
									),
								)
							}

							// Confidence-aware auto-apply: when the run's creator set a
							// threshold, findings that are machine-checkable, verified
							// deliverable, and confident enough are written to the CRM
							// without waiting for a person; everything else stays pending
							// for review. Best-effort per finding — a failure just leaves
							// that finding pending.
							// Which suggestions may be written with nobody looking is decided
							// in one place, so the rule can be checked rather than imitated.
							// The status comes off the stored row, not the event that ended
							// the run: a run that needs reading ends on the same event as any
							// other success.
							const toApply = yield* proposalsToAutoApply(sql, {
								researchId,
								runStatus: run.status,
								autoApplyMinConfidence:
									run.paidPolicy?.autoApplyMinConfidence ?? null,
							})
							yield* Effect.forEach(toApply, proposedUpdateId =>
								resolveResearchProposedUpdate(
									researchId,
									proposedUpdateId,
									'apply',
									null,
								).pipe(
									Effect.provideService(CompanyService, companyService),
									Effect.provideService(Geocoder, geocoder),
									Effect.provideService(SqlClient.SqlClient, sql),
									Effect.provideService(TimelineActivityService, timeline),
									Effect.catchCause(cause =>
										Effect.logWarning('research auto-apply failed').pipe(
											Effect.annotateLogs({
												event: 'research.autoapply.failed',
												researchId,
												cause: Cause.pretty(cause),
											}),
										),
									),
								),
							)
						}),
					).pipe(
						// Org deleted between run completion and fan-out: skip
						// rather than crash, mirroring the missing-run return above.
						Effect.catchTag('SystemOrgNotFound', e =>
							Effect.logWarning('research fan-out skipped: org not found').pipe(
								Effect.annotateLogs({
									event: 'research.fanout.unknown_org',
									orgId: e.orgId,
								}),
							),
						),
					)
				}).pipe(
					// The event sink is fire-and-forget telemetry. A transient DB
					// error here must NOT kill the research run, so log and move on;
					// only a genuine cancellation/shutdown (a pure interrupt) is let
					// through.
					Effect.catchCause(cause =>
						Cause.hasInterruptsOnly(cause)
							? Effect.interrupt
							: Effect.logWarning('research event-sink fan-out failed').pipe(
									Effect.annotateLogs({
										event: 'research.fanout.failed',
										cause: Cause.pretty(cause),
									}),
								),
					),
				),
		})
	}),
)
