import { NodeRuntime, NodeStdio } from '@effect/platform-node'
import { type Effect, Layer, Logger } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { PgLive } from './db/client'
import { McpLoggerLive } from './lib/logger'
import { CurrentUser } from './mcp/current-user'
import { McpToolsLive } from './mcp/server'
import { AgentMailProviderLive } from './services/agentmail-provider'
import { CompanyService } from './services/companies'
import { EmailService } from './services/email'
import { PageService } from './services/pages'
import { ParticipantMatcher } from './services/participant-matcher'
import { PipelineService } from './services/pipeline'
import { RecordingService } from './services/recordings'
import { S3StorageProviderLive } from './services/s3-storage-provider'
import { WebhookService } from './services/webhooks'

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
	ParticipantMatcher.layer,
	RecordingService.layer,
).pipe(Layer.provideMerge(WebhookService.layer))

const ServerLayer = McpToolsLive.pipe(
	Layer.provide(
		McpServer.layerStdio({
			name: 'forja',
			version: '1.0.0',
		}),
	),
	Layer.provide(ServicesLive),
	Layer.provide(AgentMailProviderLive),
	Layer.provide(S3StorageProviderLive),
	Layer.provide(PgLive),
	Layer.provide(
		Layer.succeed(CurrentUser, {
			userId: 'local',
			email: 'local@forja',
			name: 'Local Dev',
			isAgent: false,
		}),
	),
	Layer.provide(NodeStdio.layer),
	Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
	Layer.provide(McpLoggerLive),
)

const program = Layer.launch(ServerLayer)
NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>)
