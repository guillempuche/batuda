import { NodeRuntime, NodeStdio } from '@effect/platform-node'
import { Config, Effect, Layer, Logger } from 'effect'
import { McpServer } from 'effect/unstable/ai'
import { FetchHttpClient } from 'effect/unstable/http'

import { BookingProviderLive, IcsParserLive } from '@batuda/calendar'
import { SessionContext } from '@batuda/controllers'
import { ParticipantMatcher } from '@batuda/email/participant-matcher'
import {
	ContactDiscovery,
	makeResearchLlmLive,
	makeResearchProvidersLive,
	ResearchDispatch,
	ResearchService,
} from '@batuda/research'

import { PgLive } from './db/client'
import { McpLoggerLive } from './lib/logger'
import { ResearchDefaults } from './lib/research-defaults'
import { CurrentOrg } from './mcp/current-org'
import { CurrentUser } from './mcp/current-user'
import { McpToolsLive } from './mcp/server'
import { CalendarService } from './services/calendar'
import { CompanyService } from './services/companies'
import { CredentialCrypto } from './services/credential-crypto'
import { EmailService } from './services/email'
import { EmailAttachmentStaging } from './services/email-attachment-staging'
import { DraftStore } from './services/email-draft-store'
import { Geocoder } from './services/geocoder'
import { InstructionsService } from './services/instructions'
import { LocalInboxProviderLive } from './services/local-inbox-provider'
import { MailTransport } from './services/mail-transport'
import { PageService } from './services/pages'
import { PipelineService } from './services/pipeline'
import { RecordingService } from './services/recordings'
import { ResearchBlobStorageLive } from './services/research-blob-storage'
import { ResearchEventSinkLive } from './services/research-event-sink'
import { S3StorageProviderLive } from './services/s3-storage-provider'
import { TaskService } from './services/tasks'
import { TimelineActivityService } from './services/timeline-activity'
import { WebhookService } from './services/webhooks'

const ServicesLive = Layer.mergeAll(
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
).pipe(
	// CalendarService sits below EmailService because EmailService's inbound
	// path hands text/calendar parts to it.
	Layer.provideMerge(CalendarService.layer),
	// The email tools reach for this whenever a message carries a file.
	Layer.provideMerge(EmailAttachmentStaging.layer),
	Layer.provideMerge(DraftStore.layer),
	// A run started here lands on the timeline and fires its webhooks the same
	// way one started from the web app does — the same sink, so the two
	// surfaces cannot come to report a finished run differently. It resolves
	// the company and geocodes it while building, so it is handed those here;
	// everything it uses at call time is merged below it.
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
		// Starts at the lowest standing, so local tools reach a colleague's
		// things only when the developer says so. Set `owner` or `admin` to
		// try what someone running the organization can do.
		const role = yield* Config.string('BATUDA_ACTIVE_ORG_ROLE').pipe(
			Config.withDefault('member'),
		)
		return { id, name, slug, role }
	}),
)

// Who the tools act as. Many answer per-person rather than per-organization —
// the mailbox you send from by default, your own tasks, your research limits —
// and the ones that write record this as who did it. Required (no default) for
// the same reason the organization is: a stand-in id belongs to nobody, so
// those reads come back empty and those writes name a member who does not
// exist, and nothing in the database refuses either. Use a seeded member's id
// (`pnpm cli data users`).
//
// The address is not read anywhere on this surface — only the id is — so it
// stays a fixed label rather than something else to configure.
const LocalIdentity = Effect.gen(function* () {
	const userId = yield* Config.string('BATUDA_ACTIVE_USER_ID')
	return {
		userId,
		email: 'local@batuda',
		name: 'Local Dev',
		isAgent: false,
	}
})

const CurrentUserFromEnv = Layer.effect(CurrentUser, LocalIdentity)
const SessionFromEnv = Layer.effect(SessionContext, LocalIdentity)

const ServerLayer = McpToolsLive.pipe(
	Layer.provide(
		McpServer.layerStdio({
			name: 'batuda',
			version: '1.0.0',
		}),
	),
	// Everything the tools stand on, in the same order main.ts builds it. This
	// surface serves the whole toolkit, so it needs the whole graph — research
	// providers and all — not the handful of services the CRM tools alone use.
	Layer.provide(ServicesLive),
	Layer.provide(BookingProviderLive),
	Layer.provide(IcsParserLive),
	Layer.provide(LocalInboxProviderLive),
	Layer.provide(makeResearchProvidersLive),
	Layer.provide(makeResearchLlmLive),
	// This surface answers questions about research runs; it does not carry
	// them out. Without this an editor left connected is a second worker on the
	// developer's database, taking queued runs off it and running them —
	// competing with `pnpm dev` for the same queue, and able to spend when real
	// provider keys are configured. `pnpm dev` keeps the dispatch to itself.
	Layer.provide(Layer.succeed(ResearchDispatch)(false)),
	Layer.provide(ResearchBlobStorageLive),
	Layer.provide(S3StorageProviderLive),
	// What a research run may spend by default. The research tools ask for this
	// on their own rather than for the whole server's settings, which is what
	// lets this surface — no port, no address, no session — start at all.
	Layer.provide(ResearchDefaults.layer),
	// One shared fetch for everything above that reaches out — the calendar
	// provider, the research providers, the geocoder.
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(PgLive),
	Layer.provide(CurrentUserFromEnv),
	Layer.provide(SessionFromEnv),
	Layer.provide(CurrentOrgFromEnv),
	Layer.provide(NodeStdio.layer),
	Layer.provide(Layer.succeed(Logger.LogToStderr)(true)),
	Layer.provide(McpLoggerLive),
)

const program = Layer.launch(ServerLayer)
NodeRuntime.runMain(program)
