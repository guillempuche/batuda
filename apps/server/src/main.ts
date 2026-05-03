import { createServer } from 'node:http'

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Config, Effect, Layer } from 'effect'
import {
	FetchHttpClient,
	HttpRouter,
	HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar, OpenApi } from 'effect/unstable/httpapi'
import { SqlClient } from 'effect/unstable/sql'

import { BookingProviderLive, IcsParserLive } from '@batuda/calendar'
import { BatudaApi, CurrentOrg } from '@batuda/controllers'
import {
	makeResearchLlmLive,
	makeResearchProvidersLive,
	ResearchEventSink,
	ResearchService,
	researchToolkitLayer,
} from '@batuda/research'

import { PgLive } from './db/client'
import { AuthHandlerLive } from './handlers/auth'
import { CalendarLive } from './handlers/calendar'
import { CompaniesLive } from './handlers/companies'
import { ContactsLive } from './handlers/contacts'
import { DocumentsLive } from './handlers/documents'
import { EmailLive } from './handlers/email'
import { HealthLive } from './handlers/health'
import { InteractionsLive } from './handlers/interactions'
import { PagesLive } from './handlers/pages'
import { ProductsLive } from './handlers/products'
import { ProposalsLive } from './handlers/proposals'
import { RecordingsLive } from './handlers/recordings'
import { ResearchLive } from './handlers/research'
import { TasksLive } from './handlers/tasks'
import { TimelineLive } from './handlers/timeline'
import { WebhooksLive } from './handlers/webhooks'
import { CalcomWebhookLive } from './handlers/webhooks-calcom'
import { Auth } from './lib/auth'
import { CorsLive } from './lib/cors'
import { EnvVars } from './lib/env'
import { LoggerLive } from './lib/logger'
import { OtlpObservability } from './lib/observability'
import { McpHttpLive } from './mcp/http'
import { OrgMiddlewareLive } from './middleware/org'
import { SessionMiddlewareLive } from './middleware/session'
import { CalendarService } from './services/calendar'
import { CompanyService } from './services/companies'
import { CredentialCrypto } from './services/credential-crypto'
import { EmailService } from './services/email'
import { EmailAttachmentStaging } from './services/email-attachment-staging'
import { DraftStore } from './services/email-draft-store'
import { EmailProviderLive } from './services/email-provider-live'
import { Geocoder } from './services/geocoder'
import { InboxHealthProbe } from './services/inbox-health-probe'
import { MailTransport } from './services/mail-transport'
import { OrgResolution } from './services/org-resolution'
import { PageService } from './services/pages'
import { ParticipantMatcher } from './services/participant-matcher'
import { PipelineService } from './services/pipeline'
import { RecordingService } from './services/recordings'
import { ResearchBlobStorageLive } from './services/research-blob-storage'
import { S3StorageProviderLive } from './services/s3-storage-provider'
import {
	ResearchRunCompleted,
	TimelineActivityService,
} from './services/timeline-activity'
import { WebhookService } from './services/webhooks'

const ApiLive = HttpApiBuilder.layer(BatudaApi).pipe(
	Layer.provide([
		HealthLive,
		AuthHandlerLive,
		CompaniesLive,
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
		TimelineLive,
		CalendarLive,
		CalcomWebhookLive,
	]),
)

// Wire research event sink → WebhookService + TimelineActivityService
// Lifecycle events (succeeded/failed/cancelled) land on the timeline so the
// company activity view surfaces completed research alongside emails and
// calls; cost rows stay in research_runs / research_paid_spend.
const TIMELINE_STATUS_FOR_EVENT: Record<
	string,
	'succeeded' | 'failed' | 'cancelled' | null
> = {
	'research.succeeded': 'succeeded',
	'research.failed': 'failed',
	'research.cancelled': 'cancelled',
}

// ResearchEventSink runs out-of-band of an HTTP request — research runs
// are kicked off by users but progress events fire later, sometimes from
// background fibres. Recover the active org from the research_run row and
// provide CurrentOrg manually so org-scoped fan-out (webhooks, timeline)
// can reach the right tables.
const ResearchEventSinkLive = Layer.effect(
	ResearchEventSink,
	Effect.gen(function* () {
		const webhooks = yield* WebhookService
		const timeline = yield* TimelineActivityService
		const sql = yield* SqlClient.SqlClient
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
						query: string
						briefMd: string | null
					}>`
						SELECT organization_id, query, brief_md
						FROM research_runs
						WHERE id = ${researchId} LIMIT 1
					`
					const [run] = rows
					if (!run) return
					const orgScope: { id: string; name: string; slug: string } = {
						id: run.organizationId,
						name: '',
						slug: '',
					}
					yield* webhooks
						.fire(event, payload)
						.pipe(Effect.provideService(CurrentOrg, orgScope))
					const status = TIMELINE_STATUS_FOR_EVENT[event] ?? null
					if (!status) return
					const linkRows = yield* sql<{ subjectId: string }>`
						SELECT subject_id FROM research_links
						WHERE research_id = ${researchId}
						  AND subject_table = 'companies'
						  AND link_kind = 'input'
						LIMIT 1
					`
					const companyId = linkRows[0]?.subjectId ?? null
					yield* timeline
						.record(
							new ResearchRunCompleted({
								researchRunId: researchId,
								companyId,
								summary: run.briefMd ?? run.query,
								status,
								occurredAt: new Date(),
							}),
						)
						.pipe(Effect.provideService(CurrentOrg, orgScope))
				}).pipe(Effect.orDie),
		})
	}),
)

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
	RecordingService.layer,
	ResearchService.layer,
	Geocoder.layer.pipe(Layer.provide(FetchHttpClient.layer)),
	// daemonLayer outputs `never` so a downstream `provideMerge` would
	// skip building it (nothing requires it). Listing it inside `mergeAll`
	// forces the build, which fires the side-effect that forks the probe.
	InboxHealthProbe.daemonLayer.pipe(Layer.provide(InboxHealthProbe.layer)),
).pipe(
	// CalendarService sits below EmailService because EmailService's
	// inbound-webhook path delegates text/calendar parts to it. Keep
	// merged with provideMerge so handlers that also want a direct
	// CalendarService still see it in the merged service map.
	Layer.provideMerge(CalendarService.layer),
	Layer.provideMerge(EmailAttachmentStaging.layer),
	Layer.provideMerge(DraftStore.layer),
	Layer.provideMerge(ResearchEventSinkLive),
	Layer.provideMerge(ParticipantMatcher.layer),
	Layer.provideMerge(TimelineActivityService.layer),
	Layer.provideMerge(WebhookService.layer),
	Layer.provideMerge(CredentialCrypto.layer),
	Layer.provideMerge(MailTransport.layer),
	Layer.provideMerge(OrgResolution.layer),
)

const ServerLive = Layer.unwrap(
	Effect.gen(function* () {
		const port = yield* Config.int('PORT').pipe(Config.withDefault(3010))
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

const AppLive = Layer.mergeAll(
	ApiLive,
	McpHttpLive,
	CorsLive,
	DocsLive,
	OpenApiJsonLive,
)

const program = HttpRouter.serve(AppLive).pipe(
	Layer.provide(ServicesLive),
	Layer.provide(BookingProviderLive.pipe(Layer.provide(FetchHttpClient.layer))),
	Layer.provide(IcsParserLive),
	Layer.provide(EmailProviderLive),
	Layer.provide(researchToolkitLayer),
	Layer.provide(makeResearchProvidersLive),
	Layer.provide(makeResearchLlmLive),
	Layer.provide(ResearchBlobStorageLive),
	Layer.provide(S3StorageProviderLive),
	Layer.provide(OrgMiddlewareLive),
	Layer.provide(SessionMiddlewareLive),
	Layer.provide(Auth.layer),
	Layer.provide(EnvVars.layer),
	Layer.provide(PgLive),
	Layer.provideMerge(ServerLive),
	Layer.provide(LoggerLive),
	Layer.provide(OtlpObservability),
	Layer.launch,
)

NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>)
