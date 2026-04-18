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

import { ForjaApi } from '@engranatge/controllers'
import {
	makeResearchLlmLive,
	makeResearchProvidersLive,
	ResearchEventSink,
	ResearchService,
	researchToolkitLayer,
} from '@engranatge/research'

import { PgLive } from './db/client'
import { AgentMailWebhookLive } from './handlers/agentmail-webhook'
import { AuthHandlerLive } from './handlers/auth'
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
import { Auth } from './lib/auth'
import { CorsLive } from './lib/cors'
import { EnvVars } from './lib/env'
import { LoggerLive } from './lib/logger'
import { OtlpObservability } from './lib/observability'
import { McpHttpLive } from './mcp/http'
import { SessionMiddlewareLive } from './middleware/session'
import { CompanyService } from './services/companies'
import { EmailService } from './services/email'
import { EmailAttachmentStaging } from './services/email-attachment-staging'
import { EmailProviderLive } from './services/email-provider-live'
import { Geocoder } from './services/geocoder'
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

const ApiLive = HttpApiBuilder.layer(ForjaApi).pipe(
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
		AgentMailWebhookLive,
		RecordingsLive,
		ResearchLive,
		TimelineLive,
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

const ResearchEventSinkLive = Layer.effect(
	ResearchEventSink,
	Effect.gen(function* () {
		const webhooks = yield* WebhookService
		const timeline = yield* TimelineActivityService
		const sql = yield* SqlClient.SqlClient
		return ResearchEventSink.of({
			fire: (event, payload) =>
				Effect.gen(function* () {
					yield* webhooks.fire(event, payload)
					const status = TIMELINE_STATUS_FOR_EVENT[event] ?? null
					if (!status) return
					const researchId = (payload as { researchId?: string }).researchId
					if (!researchId) return
					const rows = yield* sql<{
						query: string
						briefMd: string | null
					}>`
						SELECT query, brief_md FROM research_runs
						WHERE id = ${researchId} LIMIT 1
					`
					const [run] = rows
					if (!run) return
					const linkRows = yield* sql<{ subjectId: string }>`
						SELECT subject_id FROM research_links
						WHERE research_id = ${researchId}
						  AND subject_table = 'companies'
						  AND link_kind = 'input'
						LIMIT 1
					`
					const companyId = linkRows[0]?.subjectId ?? null
					yield* timeline.record(
						new ResearchRunCompleted({
							researchRunId: researchId,
							companyId,
							summary: run.briefMd ?? run.query,
							status,
							occurredAt: new Date(),
						}),
					)
				}).pipe(Effect.orDie),
		})
	}),
)

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
	EmailAttachmentStaging.layer,
	ParticipantMatcher.layer,
	RecordingService.layer,
	ResearchService.layer,
	TimelineActivityService.layer,
	Geocoder.layer.pipe(Layer.provide(FetchHttpClient.layer)),
).pipe(
	Layer.provideMerge(ResearchEventSinkLive),
	Layer.provideMerge(WebhookService.layer),
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

const DocsLive = HttpApiScalar.layerCdn(ForjaApi, {
	path: '/docs',
	scalar: { theme: 'kepler', layout: 'modern' },
})

const OpenApiJsonLive = HttpRouter.add(
	'GET',
	'/openapi.json',
	HttpServerResponse.json(OpenApi.fromApi(ForjaApi)),
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
	Layer.provide(EmailProviderLive),
	Layer.provide(researchToolkitLayer),
	Layer.provide(makeResearchProvidersLive),
	Layer.provide(makeResearchLlmLive),
	Layer.provide(ResearchBlobStorageLive),
	Layer.provide(S3StorageProviderLive),
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
