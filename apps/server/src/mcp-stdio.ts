import { NodeRuntime, NodeStdio } from '@effect/platform-node'
import { Config, Effect, Layer, Logger } from 'effect'
import { McpServer } from 'effect/unstable/ai'

import { PgLive } from './db/client'
import { McpLoggerLive } from './lib/logger'
import { CurrentOrg } from './mcp/current-org'
import { CurrentUser } from './mcp/current-user'
import { McpToolsLive } from './mcp/server'
import { CompanyService } from './services/companies'
import { CredentialCrypto } from './services/credential-crypto'
import { EmailService } from './services/email'
import { LocalInboxProviderLive } from './services/local-inbox-provider'
import { MailTransport } from './services/mail-transport'
import { PageService } from './services/pages'
import { ParticipantMatcher } from './services/participant-matcher'
import { PipelineService } from './services/pipeline'
import { RecordingService } from './services/recordings'
import { S3StorageProviderLive } from './services/s3-storage-provider'
import { TimelineActivityService } from './services/timeline-activity'
import { WebhookService } from './services/webhooks'

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
	RecordingService.layer,
).pipe(
	Layer.provideMerge(ParticipantMatcher.layer),
	Layer.provideMerge(TimelineActivityService.layer),
	Layer.provideMerge(WebhookService.layer),
	Layer.provideMerge(CredentialCrypto.layer),
	Layer.provideMerge(MailTransport.layer),
)

// MCP stdio is a local-dev convenience surface (Cursor / Claude Desktop on
// the developer's machine). It carries no Better-Auth session, so the org
// the tools should act in must be supplied explicitly via env. Required
// (no default) per the explicit-env-vars convention; auto-resolution would
// silently target whatever org the migration happened to seed first.
const CurrentOrgFromEnv = Layer.effect(
	CurrentOrg,
	Effect.gen(function* () {
		const id = yield* Config.string('BATUDA_ACTIVE_ORG_ID')
		const name = yield* Config.string('BATUDA_ACTIVE_ORG_NAME')
		const slug = yield* Config.string('BATUDA_ACTIVE_ORG_SLUG')
		return { id, name, slug }
	}),
)

const ServerLayer = McpToolsLive.pipe(
	Layer.provide(
		McpServer.layerStdio({
			name: 'batuda',
			version: '1.0.0',
		}),
	),
	Layer.provide(ServicesLive),
	Layer.provide(LocalInboxProviderLive),
	Layer.provide(S3StorageProviderLive),
	Layer.provide(PgLive),
	Layer.provide(
		Layer.succeed(CurrentUser, {
			userId: 'local',
			email: 'local@batuda',
			name: 'Local Dev',
			isAgent: false,
		}),
	),
	Layer.provide(CurrentOrgFromEnv),
	Layer.provide(NodeStdio.layer),
	Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
	Layer.provide(McpLoggerLive),
)

const program = Layer.launch(ServerLayer)
NodeRuntime.runMain(program as unknown as Effect.Effect<void, unknown, never>)
