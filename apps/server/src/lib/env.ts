import { Config, Effect, Layer, Schema, ServiceMap } from 'effect'

export class EnvVars extends ServiceMap.Service<EnvVars>()('EnvVars', {
	make: Effect.gen(function* () {
		const DATABASE_URL = yield* Config.redacted('DATABASE_URL')
		const PORT = yield* Config.int('PORT').pipe(Config.withDefault(3010))
		const NODE_ENV = yield* Config.string('NODE_ENV').pipe(
			Config.withDefault('development'),
		)
		const MIN_LOG_LEVEL = yield* Config.string('MIN_LOG_LEVEL').pipe(
			Config.withDefault('Info'),
		)

		const BETTER_AUTH_SECRET = yield* Config.redacted('BETTER_AUTH_SECRET')
		const BETTER_AUTH_BASE_URL = yield* Config.string(
			'BETTER_AUTH_BASE_URL',
		).pipe(Config.withDefault(''))
		const BETTER_AUTH_INSECURE_COOKIES = yield* Config.boolean(
			'BETTER_AUTH_INSECURE_COOKIES',
		).pipe(Config.withDefault(false))
		const ALLOWED_ORIGINS = yield* Config.string('ALLOWED_ORIGINS').pipe(
			Config.withDefault(''),
			Config.map(s => (s ? s.split(',').map(o => o.trim()) : [])),
		)

		// S3-compatible object storage. Same code path serves MinIO (local
		// dev) and Cloudflare R2 (prod) — only the endpoint/credentials
		// change. All required, no defaults: storage credentials must be
		// configured explicitly per environment.
		const STORAGE_ENDPOINT = yield* Config.string('STORAGE_ENDPOINT')
		const STORAGE_REGION = yield* Config.string('STORAGE_REGION')
		const STORAGE_ACCESS_KEY_ID = yield* Config.string('STORAGE_ACCESS_KEY_ID')
		const STORAGE_SECRET_ACCESS_KEY = yield* Config.redacted(
			'STORAGE_SECRET_ACCESS_KEY',
		)
		const STORAGE_BUCKET = yield* Config.string('STORAGE_BUCKET')

		const EMAIL_API_KEY = yield* Config.redacted('EMAIL_API_KEY')
		const EMAIL_WEBHOOK_SECRET = yield* Config.option(
			Config.redacted('EMAIL_WEBHOOK_SECRET'),
		)
		// No default — the developer must explicitly choose `local-inbox`
		// (dev catcher) or `agentmail` (real send). Forcing the choice
		// prevents local config from silently leaking into prod and vice
		// versa. The .env.example suggests `local-inbox` for local dev.
		const EMAIL_PROVIDER = yield* Config.schema(
			Schema.Literals(['local-inbox', 'agentmail']),
			'EMAIL_PROVIDER',
		)

		// ── Research capability providers ──
		// Each is explicit, no `auto` or fallback. Boot fails if unset.
		const RESEARCH_SEARCH_PROVIDER = yield* Config.schema(
			Schema.Literals(['stub', 'brave', 'firecrawl']),
			'RESEARCH_SEARCH_PROVIDER',
		)
		const RESEARCH_SCRAPE_PROVIDER = yield* Config.schema(
			Schema.Literals(['stub', 'firecrawl', 'local']),
			'RESEARCH_SCRAPE_PROVIDER',
		)
		const RESEARCH_EXTRACT_PROVIDER = yield* Config.schema(
			Schema.Literals(['stub', 'firecrawl', 'local']),
			'RESEARCH_EXTRACT_PROVIDER',
		)
		const RESEARCH_DISCOVER_PROVIDER = yield* Config.schema(
			Schema.Literals(['stub', 'firecrawl', 'anthropic', 'none']),
			'RESEARCH_DISCOVER_PROVIDER',
		)
		const RESEARCH_REGISTRY_PROVIDER_ES = yield* Config.schema(
			Schema.Literals(['stub', 'librebor', 'none']),
			'RESEARCH_REGISTRY_PROVIDER_ES',
		)
		const RESEARCH_REPORT_PROVIDER_ES = yield* Config.schema(
			Schema.Literals(['stub', 'einforma', 'none']),
			'RESEARCH_REPORT_PROVIDER_ES',
		)

		// Budget defaults (system-level)
		const RESEARCH_DEFAULT_BUDGET_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_BUDGET_CENTS',
		).pipe(Config.withDefault(100))
		const RESEARCH_DEFAULT_PAID_BUDGET_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_PAID_BUDGET_CENTS',
		).pipe(Config.withDefault(500))
		const RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS',
		).pipe(Config.withDefault(200))
		const RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS',
		).pipe(Config.withDefault(2000))
		const RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS = yield* Config.int(
			'RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS',
		).pipe(Config.withDefault(10000))

		// Concurrency and safety
		const RESEARCH_MAX_CONCURRENT_FIBERS_PER_USER = yield* Config.int(
			'RESEARCH_MAX_CONCURRENT_FIBERS_PER_USER',
		).pipe(Config.withDefault(3))
		const RESEARCH_MAX_CONCURRENCY_FANOUT = yield* Config.int(
			'RESEARCH_MAX_CONCURRENCY_FANOUT',
		).pipe(Config.withDefault(3))
		const RESEARCH_CONFIRM_THRESHOLD_FANOUT = yield* Config.int(
			'RESEARCH_CONFIRM_THRESHOLD_FANOUT',
		).pipe(Config.withDefault(10))

		// Provider API keys (optional — only needed for selected providers)
		const FIRECRAWL_API_KEY = yield* Config.option(
			Config.redacted('FIRECRAWL_API_KEY'),
		)
		const BRAVE_SEARCH_API_KEY = yield* Config.option(
			Config.redacted('BRAVE_SEARCH_API_KEY'),
		)
		const EINFORMA_API_KEY = yield* Config.option(
			Config.redacted('EINFORMA_API_KEY'),
		)

		// LLM inference provider (for research agent loop)
		const RESEARCH_LLM_PROVIDER = yield* Config.string(
			'RESEARCH_LLM_PROVIDER',
		).pipe(Config.withDefault('stub'))
		const RESEARCH_LLM_MODEL = yield* Config.option(
			Config.string('RESEARCH_LLM_MODEL'),
		)
		const RESEARCH_LLM_API_KEY = yield* Config.option(
			Config.redacted('RESEARCH_LLM_API_KEY'),
		)
		const RESEARCH_LLM_BASE_URL = yield* Config.option(
			Config.string('RESEARCH_LLM_BASE_URL'),
		)

		return {
			DATABASE_URL,
			PORT,
			NODE_ENV,
			MIN_LOG_LEVEL,
			BETTER_AUTH_SECRET,
			BETTER_AUTH_BASE_URL,
			BETTER_AUTH_INSECURE_COOKIES,
			ALLOWED_ORIGINS,
			STORAGE_ENDPOINT,
			STORAGE_REGION,
			STORAGE_ACCESS_KEY_ID,
			STORAGE_SECRET_ACCESS_KEY,
			STORAGE_BUCKET,
			EMAIL_API_KEY,
			EMAIL_WEBHOOK_SECRET,
			EMAIL_PROVIDER,
			RESEARCH_SEARCH_PROVIDER,
			RESEARCH_SCRAPE_PROVIDER,
			RESEARCH_EXTRACT_PROVIDER,
			RESEARCH_DISCOVER_PROVIDER,
			RESEARCH_REGISTRY_PROVIDER_ES,
			RESEARCH_REPORT_PROVIDER_ES,
			RESEARCH_DEFAULT_BUDGET_CENTS,
			RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
			RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
			RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
			RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
			RESEARCH_MAX_CONCURRENT_FIBERS_PER_USER,
			RESEARCH_MAX_CONCURRENCY_FANOUT,
			RESEARCH_CONFIRM_THRESHOLD_FANOUT,
			FIRECRAWL_API_KEY,
			BRAVE_SEARCH_API_KEY,
			EINFORMA_API_KEY,
			RESEARCH_LLM_PROVIDER,
			RESEARCH_LLM_MODEL,
			RESEARCH_LLM_API_KEY,
			RESEARCH_LLM_BASE_URL,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
