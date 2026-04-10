import { createServer } from 'node:http'

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Config, Effect, Layer, Schema } from 'effect'
import {
	HttpMiddleware,
	HttpRouter,
	HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar, OpenApi } from 'effect/unstable/httpapi'

import { ForjaApi } from '@engranatge/controllers'

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
import { LocalInboxProviderLive } from './services/local-inbox-provider'
import { PageService } from './services/pages'
import { PipelineService } from './services/pipeline'
import { RecordingService } from './services/recordings'
import { S3StorageProviderLive } from './services/s3-storage-provider'
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
	]),
)

const ServicesLive = Layer.mergeAll(
	CompanyService.layer,
	PipelineService.layer,
	PageService.layer,
	EmailService.layer,
	RecordingService.layer,
).pipe(Layer.provideMerge(WebhookService.layer))

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

// Pick the EmailProvider layer at boot from EMAIL_PROVIDER. There is **no**
// auto/default — the developer must explicitly choose `local-inbox` (dev
// catcher) or `agentmail` (real send). Forcing the choice keeps the
// developer conscious of which side of the network they're on and prevents
// local config from silently leaking into prod or vice versa.
const EmailProviderLive = Layer.unwrap(
	Effect.gen(function* () {
		const provider = yield* Config.schema(
			Schema.Literals(['local-inbox', 'agentmail']),
			'EMAIL_PROVIDER',
		)
		yield* Effect.logInfo(`email provider: ${provider}`)
		return provider === 'agentmail'
			? AgentMailProviderLive
			: LocalInboxProviderLive
	}),
)

/**
 * Cross-origin policy for the API.
 *
 * Forja (`forja.engranatge.localhost`) and the marketing site
 * (`engranatge.localhost`) talk to this API at
 * `api.engranatge.localhost` via portless. All three sit behind
 * portless's HTTPS reverse proxy, so every request is cross-origin.
 *
 * `ALLOWED_ORIGINS` is a comma-separated env var that supports glob
 * wildcards (e.g. `https://*.engranatge.localhost`). Wildcards let
 * portless git-worktree subdomains (like
 * `fix-ui.forja.engranatge.localhost`) pass CORS without listing every
 * branch. The same env var is fed to Better-Auth as `trustedOrigins`
 * (see `lib/auth.ts`) — Better-Auth supports wildcards natively, and
 * the two must agree or sign-in requests will be rejected.
 *
 * `credentials: true` is required because the browser will only attach
 * the `forja.*` session cookie when the request is `credentials:
 * 'include'` AND the server responds with
 * `Access-Control-Allow-Credentials: true` AND a specific origin (the
 * CORS spec forbids the `*` wildcard with credentials). Effect's
 * `HttpMiddleware.cors` receives a predicate and echoes back the exact
 * request `Origin` when it passes.
 *
 * `allowedHeaders` is intentionally left unset so preflight responses
 * echo back whatever the browser asks for (via the
 * `Access-Control-Request-Headers` header). This covers `Content-Type:
 * application/json`, `Authorization: Bearer ...` (Better-Auth bearer
 * plugin), `x-api-key` (Better-Auth api-key plugin for invite flow),
 * and anything future plugins introduce, without having to remember to
 * extend the list every time.
 */
const CorsLive = Layer.unwrap(
	Effect.gen(function* () {
		const configured = yield* Config.string('ALLOWED_ORIGINS').pipe(
			Config.withDefault(''),
			Config.map(s => (s ? s.split(',').map(o => o.trim()) : [])),
		)
		const allowedOrigins =
			configured.length > 0
				? configured
				: ['https://forja.engranatge.localhost', 'https://engranatge.localhost']

		// Predicate that supports glob wildcards (e.g. "https://*.engranatge.localhost")
		// so portless git-worktree subdomains like fix-ui.forja.engranatge.localhost
		// are accepted without listing every branch.
		const isAllowedOrigin = (origin: string): boolean =>
			allowedOrigins.some(pattern => {
				if (!pattern.includes('*')) return origin === pattern
				const re = new RegExp(
					`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]*')}$`,
				)
				return re.test(origin)
			})

		yield* Effect.logInfo(`cors allowed origins: ${allowedOrigins.join(', ')}`)
		return HttpRouter.middleware(
			HttpMiddleware.cors({
				allowedOrigins: isAllowedOrigin,
				credentials: true,
				exposedHeaders: ['content-length', 'content-type'],
				maxAge: 86400,
			}),
			{ global: true },
		)
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
