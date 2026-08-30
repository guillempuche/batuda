import { createServer } from 'node:http'

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Config, Effect, Layer } from 'effect'
import {
	FetchHttpClient,
	HttpMiddleware,
	HttpRouter,
	HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar, OpenApi } from 'effect/unstable/httpapi'

import { BookingProviderLive, IcsParserLive } from '@batuda/calendar'
import { BatudaApi } from '@batuda/controllers'
import { ParticipantMatcher } from '@batuda/email/participant-matcher'
import {
	ContactDiscovery,
	makeResearchLlmLive,
	makeResearchProvidersLive,
	ResearchDispatch,
	ResearchService,
} from '@batuda/research'
import { TimelineActivityService } from '@batuda/timeline'

import { PgLive } from './db/client'
import { ApiKeysLive } from './handlers/api-keys'
import { AuthHandlerLive } from './handlers/auth'
import { CalendarLive } from './handlers/calendar'
import { CompaniesLive } from './handlers/companies'
import { CompanyIndustriesLive } from './handlers/company-industries'
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
import { installCrashGuards } from './lib/crash-guards'
import { EnvVars } from './lib/env'
import { withGlobalMiddlewareOrder } from './lib/global-middleware-order'
import { LoggerLive } from './lib/logger'
import { OtlpObservability } from './lib/observability'
import { ResearchDefaults } from './lib/research-defaults'
import { WellKnownLive } from './lib/well-known'
import { McpHttpLive } from './mcp/http'
import { OrgMiddlewareLive } from './middleware/org'
import { SessionMiddlewareLive } from './middleware/session'
import { ApiKeyService } from './services/api-keys'
import { CalendarService } from './services/calendar'
import { CompanyService } from './services/companies'
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
import { ResearchBlobStorageLive } from './services/research-blob-storage'
import { ResearchEventSinkLive } from './services/research-event-sink'
import { ResearchRetention } from './services/research-retention'
import { S3StorageProviderLive } from './services/s3-storage-provider'
import { TaskService } from './services/tasks'
import { WebhookService } from './services/webhooks'

const ApiLive = HttpApiBuilder.layer(BatudaApi).pipe(
	Layer.provide([
		HealthLive,
		AuthHandlerLive,
		ApiKeysLive,
		McpOAuthLive,
		MembersLive,
		CompaniesLive,
		CompanyIndustriesLive,
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

// Observability and CORS are NOT in this list on purpose: a merge decides no
// order between router-wide middleware, and these two have to run outside the
// MCP sign-in check. `withGlobalMiddlewareOrder` explains why and is where that
// order is pinned and tested.
const AppLive = withGlobalMiddlewareOrder(
	Layer.mergeAll(
		ApiLive,
		McpHttpLive,
		TracerDisabledLive,
		DocsLive,
		OpenApiJsonLive,
		WellKnownLive,
	),
)

// `CurrentOrg` is request-scoped — provided per request by OrgMiddleware
// (HTTP), McpAuthMiddleware (MCP tools), `enterOrgScope` (cal.com webhook),
// and inline `Effect.provideService` calls in ResearchEventSinkLive. It
// surfaces in the program's R only because Tool.make declares
// `dependencies: [CurrentOrg]` for typing.
//
// No root layer for it on purpose: registering a toolkit snapshots the
// service map once, when the layer is built, and re-injects that snapshot on
// every tool call — where it OVERRIDES the request's own services rather than
// deferring to them. A boot-time placeholder would therefore replace the real
// value McpAuthMiddleware resolved, and every tool would read another
// organization's rows, or none. Leaving the tag absent at boot keeps it out of
// the snapshot, so the request's value is what survives.
//
// The runMain cast type-erases the unsatisfied requirement. A
// defect-throwing fallback would surface accidental out-of-scope reads
// more loudly but crashes startup for the same snapshot reason. The pattern
// stops being necessary when the library defers that capture to request time.
// The regression guard is the "should not surface a CurrentOrg
// out-of-request-scope Defect" case in main.boot.test.ts, which runs under
// `pnpm --filter @batuda/server test:boot` rather than `pnpm test`.

// No tracer is passed here. The platform opens a per-request span itself,
// whether middleware is given or not, and that span is what per-route
// annotations (request id, org id, tool name) attach to. Passing one as well
// wraps every request twice and leaves a bare duplicate span beside each real
// one — two rows per request, so every count reads double. The routes exempt
// from tracing are the ones `TracerDisabledLive` names above; the platform's own
// wrapping reads that same list.
const program = HttpRouter.serve(AppLive, {
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
	// Settings, none of which depend on the others, so one provide rather than
	// three. ResearchDispatch says this is the process that carries queued
	// research runs out — said here rather than left to its default, because a
	// default that later changes its mind would stop production running
	// research with nothing failing: no error, no red test, just runs piling
	// up queued.
	Layer.provide([
		EnvVars.layer,
		ResearchDefaults.layer,
		Layer.succeed(ResearchDispatch)(true),
	]),
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
