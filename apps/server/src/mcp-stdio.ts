import { NodeRuntime, NodeStdio } from '@effect/platform-node'
import { type Effect, Layer, Logger } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { PgLive } from './db/client'
import { McpToolsLive } from './mcp/server'
import { CompanyService } from './services/companies'
import { PageService } from './services/pages'
import { PipelineService } from './services/pipeline'
import { WebhookService } from './services/webhooks'

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	WebhookService.layer,
)

const ServerLayer = McpToolsLive.pipe(
	Layer.provide(
		McpServer.layerStdio({
			name: 'batuda',
			version: '1.0.0',
		}),
	),
	Layer.provide(ServicesLive),
	Layer.provide(PgLive),
	Layer.provide(NodeStdio.layer),
	Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
)

const program = Layer.launch(ServerLayer)
NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>)
