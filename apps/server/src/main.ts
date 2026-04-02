import { createServer } from 'node:http'

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Config, Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ForjaApi } from './api'
import { PgLive } from './db/client'
import { CompaniesLive } from './handlers/companies'
import { ContactsLive } from './handlers/contacts'
import { DocumentsLive } from './handlers/documents'
import { HealthLive } from './handlers/health'
import { InteractionsLive } from './handlers/interactions'
import { PagesLive } from './handlers/pages'
import { ProductsLive } from './handlers/products'
import { ProposalsLive } from './handlers/proposals'
import { TasksLive } from './handlers/tasks'
import { WebhooksLive } from './handlers/webhooks'
import { LoggerLive } from './lib/logger'
import { OtlpObservability } from './lib/observability'
import { CompanyService } from './services/companies'
import { PageService } from './services/pages'
import { WebhookService } from './services/webhooks'

const ApiLive = HttpApiBuilder.layer(ForjaApi).pipe(
	Layer.provide([
		HealthLive,
		CompaniesLive,
		ContactsLive,
		InteractionsLive,
		TasksLive,
		DocumentsLive,
		ProductsLive,
		ProposalsLive,
		PagesLive,
		WebhooksLive,
	]),
)

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PageService.layer,
	WebhookService.layer,
)

const ServerLive = Layer.unwrap(
	Effect.gen(function* () {
		const port = yield* Config.int('PORT').pipe(Config.withDefault(3010))
		return NodeHttpServer.layer(createServer, { port })
	}),
)

const program = HttpRouter.serve(ApiLive).pipe(
	Layer.provide(ServicesLive),
	Layer.provide(PgLive),
	Layer.provideMerge(ServerLive),
	Layer.provide(LoggerLive),
	Layer.provide(OtlpObservability),
	Layer.launch,
)

NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>)
