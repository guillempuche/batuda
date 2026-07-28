import { createServer } from 'node:http'

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Cause, Config, DateTime, Effect, Layer } from 'effect'
import {
	FetchHttpClient,
	HttpMiddleware,
	HttpRouter,
	HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar, OpenApi } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BookingProviderLive, IcsParserLive } from '@batuda/calendar'
import { BatudaApi } from '@batuda/controllers'
import { ParticipantMatcher } from '@batuda/email/participant-matcher'
import {
	ContactDiscovery,
	makeResearchLlmLive,
	makeResearchProvidersLive,
	ResearchEventSink,
	ResearchService,
} from '@batuda/research'

import { PgLive } from './db/client'
import { ApiKeysLive } from './handlers/api-keys'
import { AuthHandlerLive } from './handlers/auth'
import { CalendarLive } from './handlers/calendar'
import { CompaniesLive } from './handlers/companies'
import { ContactsLive } from './handlers/contacts'
import { DocumentsLive } from './handlers/documents'
import { EmailLive } from './handlers/email'
import { HealthLive } from './handlers/health'
import { InstructionsLive } from './handlers/instructions'
import { InteractionsLive } from './handlers/interactions'
import { McpOAuthLive } from './handlers/mcp-oauth'
import { MembersLive } from './handlers/members'
import { PagesLive } from './handlers/pages'
import { PipelineLive } from './handlers/pipeline'
import { ProductsLive } from './handlers/products'
import { ProposalsLive } from './handlers/proposals'
import { RecordingsLive } from './handlers/recordings'
import { ResearchLive } from './handlers/research'
import { TasksLive } from './handlers/tasks'
import { TimelineLive } from './handlers/timeline'
import { WebhooksLive } from './handlers/webhooks'
import { CalcomWebhookLive } from './handlers/webhooks-calcom'
import { Auth } from './lib/auth'
import { ConfigFileLive } from './lib/config-provider'
import { CorsLive } from './lib/cors'
import { installCrashGuards } from './lib/crash-guards'
import { EnvVars } from './lib/env'
import { LoggerLive } from './lib/logger'
import { OtlpObservability } from './lib/observability'
import { ObservabilityLive } from './lib/observability-middleware'
import { WellKnownLive } from './lib/well-known'
import { McpHttpLive } from './mcp/http'
import { OrgMiddlewareLive, resolveSystemOrg } from './middleware/org'
import { SessionMiddlewareLive } from './middleware/session'
import { ApiKeyService } from './services/api-keys'
import { CalendarService } from './services/calendar'
import { CompanyService } from './services/companies'
import { geocodeCompany } from './services/company-geocoding'
import { CredentialCrypto } from './services/credential-crypto'
import { EmailService } from './services/email'
import { EmailAttachmentStaging } from './services/email-attachment-staging'
import { DraftStore } from './services/email-draft-store'
import { EmailProviderLive } from './services/email-provider-live'
import { Geocoder } from './services/geocoder'
import { InboxHealthProbe } from './services/inbox-health-probe'
import { InstructionsService } from './services/instructions'
import { MailTransport } from './services/mail-transport'
import { McpOAuthService } from './services/mcp-oauth'
import { MemberService } from './services/members'
import { OrgResolution } from './services/org-resolution'
import { PageService } from './services/pages'
import { PipelineService } from './services/pipeline'
import { RecordingService } from './services/recordings'
import { resolveResearchProposedUpdate } from './services/research-apply'
import { proposalsToAutoApply } from './services/research-auto-apply'
import { ResearchBlobStorageLive } from './services/research-blob-storage'
import { ResearchRetention } from './services/research-retention'
import { S3StorageProviderLive } from './services/s3-storage-provider'
import { TaskService } from './services/tasks'
import {
	ResearchRunCompleted,
	TimelineActivityService,
} from './services/timeline-activity'
import { WebhookService } from './services/webhooks'

const ApiLive = HttpApiBuilder.layer(BatudaApi).pipe(
	Layer.provide([
		HealthLive,
		AuthHandlerLive,
		ApiKeysLive,
		McpOAuthLive,
		MembersLive,
		CompaniesLive,
		PipelineLive,
		ContactsLive,
		InteractionsLive,
		TasksLive,
		DocumentsLive,
		ProductsLive,
		ProposalsLive,
		PagesLive,
		WebhooksLive,
		EmailLive,
		RecordingsLive,
		ResearchLive,
		InstructionsLive,
		TimelineLive,
		CalendarLive,
		CalcomWebhookLive,
	]),
)

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
const ResearchEventSinkLive = Layer.effect(
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

const ServicesLive = Layer.mergeAll(
	ApiKeyService.layer,
	McpOAuthService.layer,
	MemberService.layer,
	CompanyService.layer,
	TaskService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
	RecordingService.layer,
	// ResearchService's in-loop discover_contacts tool delegates to
	// ContactDiscovery, so it is provided here — and re-exposed via provideMerge
	// so the standalone discover_contacts tool, which also uses it, still sees it.
	ResearchService.layer.pipe(Layer.provideMerge(ContactDiscovery.layer)),
	InstructionsService.layer,
	Geocoder.layer,
	// daemonLayer outputs `never` so a downstream `provideMerge` would
	// skip building it (nothing requires it). Listing it inside `mergeAll`
	// forces the build, which fires the side-effect that forks the probe.
	InboxHealthProbe.daemonLayer.pipe(Layer.provide(InboxHealthProbe.layer)),
	// Same `never`-output trick; EmailAttachmentStaging is supplied via the `provideMerge` below.
	EmailAttachmentStaging.sweepDaemonLayer,
	// Prunes expired research caches, old run transcripts, and orphaned scrape
	// blobs. Same `never`-output trick; the service is supplied below.
	ResearchRetention.sweepDaemonLayer,
).pipe(
	// CalendarService sits below EmailService because EmailService's
	// inbound-webhook path delegates text/calendar parts to it. Keep
	// merged with provideMerge so handlers that also want a direct
	// CalendarService still see it in the merged service map.
	Layer.provideMerge(CalendarService.layer),
	Layer.provideMerge(EmailAttachmentStaging.layer),
	Layer.provideMerge(ResearchRetention.layer),
	Layer.provideMerge(DraftStore.layer),
	// The sink resolves the enriched company and geocodes it, so it needs
	// CompanyService + Geocoder at build time. They live in the merged base
	// below, which feeds consumers but not this provider — supply them here.
	Layer.provideMerge(
		ResearchEventSinkLive.pipe(
			Layer.provide(CompanyService.layer),
			Layer.provide(Geocoder.layer),
		),
	),
	Layer.provideMerge(ParticipantMatcher.layer),
	Layer.provideMerge(TimelineActivityService.layer),
	Layer.provideMerge(WebhookService.layer),
	Layer.provideMerge(CredentialCrypto.layer),
	Layer.provideMerge(MailTransport.layer),
	Layer.provideMerge(OrgResolution.layer),
)

const ServerLive = Layer.unwrap(
	Effect.gen(function* () {
		const port = yield* Config.int('PORT')
		const portlessUrl = yield* Config.string('PORTLESS_URL').pipe(
			Config.withDefault(''),
		)
		const base = portlessUrl || `http://localhost:${port}`

		yield* Effect.logInfo(`docs:     ${base}/docs`)
		yield* Effect.logInfo(`openapi:  ${base}/openapi.json`)
		yield* Effect.logInfo(`auth:     ${base}/auth/reference`)

		return NodeHttpServer.layer(createServer, { port })
	}),
)

// ── API documentation ─────────────────────────────────────
// Scalar interactive docs at /docs, raw OpenAPI 3.1 spec at /openapi.json.
// Better Auth also serves its own Scalar docs at /auth/reference
// and raw schema at /auth/open-api/generate-schema.

const DocsLive = HttpApiScalar.layerCdn(BatudaApi, {
	path: '/docs',
	scalar: { theme: 'kepler', layout: 'modern' },
})

const OpenApiJsonLive = HttpRouter.add(
	'GET',
	'/openapi.json',
	HttpServerResponse.json(OpenApi.fromApi(BatudaApi)),
)

// Routes where tracing is suppressed. The tracer records `url.full`/`url.query`
// UNREDACTED, so any route whose URL itself carries a secret must be exempt or
// the token lands in Honeycomb: magic-link verify (token in query) and
// reset-password (token in path). `/health` is exempt too — the uptime checker
// polls it constantly and would otherwise drown the real traces. Matched on the
// path alone so a query string (e.g. `/health?x=1`) doesn't slip through.
const TracerDisabledLive = Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
	request => {
		const path = request.url.split('?')[0] ?? request.url
		return (
			path === '/health' ||
			path.startsWith('/auth/magic-link/verify') ||
			path.startsWith('/auth/reset-password')
		)
	},
)

const AppLive = Layer.mergeAll(
	ApiLive,
	McpHttpLive,
	CorsLive,
	ObservabilityLive,
	TracerDisabledLive,
	DocsLive,
	OpenApiJsonLive,
	WellKnownLive,
)

// `CurrentOrg` is request-scoped — provided per request by OrgMiddleware
// (HTTP), McpAuthMiddleware (MCP tools), `enterOrgScope` (cal.com webhook),
// and inline `Effect.provideService` calls in ResearchEventSinkLive. It
// surfaces in the program's R only because Tool.make declares
// `dependencies: [CurrentOrg]` for typing.
//
// No root layer for it on purpose: `McpServer.toolkit(...)` snapshots the
// service map at layer-build time (effect/src/unstable/ai/McpServer.ts:610)
// and re-injects it per tool call via `Effect.provideContext`, where
// `Context.merge` lets the snapshot OVERRIDE the request fiber. A
// boot-time sentinel would clobber McpAuthMiddleware's real value and
// return empty/foreign rows from every tool; leaving the tag absent at
// boot keeps it out of the snapshot so the request value survives.
//
// The runMain cast type-erases the unsatisfied requirement. A
// defect-throwing fallback would surface accidental out-of-scope reads
// more loudly but crashes startup for the same snapshot reason. The
// pattern stops being necessary when upstream defers `McpServer.toolkit`
// capture to request time; `main.boot.test.ts:149-156` is the regression
// guard (not in `pnpm test` today — run via `pnpm test:integration`).

// `HttpMiddleware.tracer` wraps the whole server chain in a per-request span so
// traces export to OTLP and per-route span annotations (request id, org id, tool
// name) have a span to attach to. `serve` already adds the request logger; this
// adds the missing tracer. `/health` is exempted from tracing inside AppLive.
const program = HttpRouter.serve(AppLive, {
	middleware: HttpMiddleware.tracer,
	// Disable Effect's built-in request logger: in this version it annotates
	// `http.url` with the RAW request URL, so a magic-link/reset token in the URL
	// would export verbatim to OTLP. ObservabilityLive emits a sanitized
	// completion log (path_pattern, query stripped) in its place.
	disableLogger: true,
}).pipe(
	Layer.provide(ServicesLive),
	Layer.provide(BookingProviderLive),
	Layer.provide(IcsParserLive),
	Layer.provide(EmailProviderLive),
	Layer.provide(makeResearchProvidersLive),
	Layer.provide(makeResearchLlmLive),
	Layer.provide(ResearchBlobStorageLive),
	Layer.provide(S3StorageProviderLive),
	Layer.provide(OrgMiddlewareLive),
	Layer.provide(SessionMiddlewareLive),
	Layer.provide(Auth.layer),
	// Provided once at the bottom of the stack so every layer above (booking,
	// brave search, calcom, geocoder, inbox-health-probe, …) can pick up
	// `HttpClient.HttpClient` from a single shared fetch.
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(EnvVars.layer),
	Layer.provide(PgLive),
	Layer.provideMerge(ServerLive),
	// OtlpObservability sits ABOVE LoggerLive so its OTLP logger merges ON TOP of
	// LoggerLive's clean console+tracer+file set (OtlpLogger defaults to
	// mergeWithExisting). The reverse order would let LoggerLive — which REPLACES
	// the logger set — drop the OTLP logger, so non-span logs (detached fibers,
	// boot, Better Auth callbacks) would never reach Honeycomb's /v1/logs. When
	// OTLP is off, OtlpObservability is Layer.empty and LoggerLive's set shows
	// through unchanged (no duplicated default logger).
	Layer.provide(OtlpObservability),
	Layer.provide(LoggerLive),
	// Bottom of the stack so the baked-file ConfigProvider underlies every
	// Config reader above it — including LoggerLive's MIN_LOG_LEVEL, which in
	// prod lives only in the file, not on the cmdline. A higher placement would
	// leave the lower readers on env-only and fail when their keys aren't set.
	Layer.provide(ConfigFileLive),
	Layer.launch,
)

// Turn on the crash safety net before the server starts, so a rare low-level
// error gets logged and the process auto-restarted instead of dying silently.
// See crash-guards.ts.
installCrashGuards()

NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>)
