import { createServer } from 'node:http'

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Config, Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from './api'
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
import { TasksLive } from './handlers/tasks'
import { WebhooksLive } from './handlers/webhooks'
import { Auth } from './lib/auth'
import { EnvVars } from './lib/env'
import { LoggerLive } from './lib/logger'
import { OtlpObservability } from './lib/observability'
import { McpHttpLive } from './mcp/http'
import { SessionMiddlewareLive } from './middleware/session'
import { AgentMailProviderLive } from './services/agentmail-provider'
import { CompanyService } from './services/companies'
import { EmailService } from './services/email'
import { PageService } from './services/pages'
import { PipelineService } from './services/pipeline'
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
	]),
)

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
).pipe(Layer.provideMerge(WebhookService.layer))

const ServerLive = Layer.unwrap(
	Effect.gen(function* () {
		const port = yield* Config.int('PORT').pipe(Config.withDefault(3010))
		return NodeHttpServer.layer(createServer, { port })
	}),
)

const AppLive = Layer.merge(ApiLive, McpHttpLive)

const program = HttpRouter.serve(AppLive).pipe(
	Layer.provide(ServicesLive),
	Layer.provide(AgentMailProviderLive),
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
