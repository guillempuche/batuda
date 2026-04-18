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
		// Required (no default): cookie-domain derivation depends on this,
		// so a missing value in prod would ship broken auth silently.
		const BETTER_AUTH_BASE_URL = yield* Config.string('BETTER_AUTH_BASE_URL')
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
		// Required, no default: webhook signature verification is not
		// opt-in. Missing secret would force a silent "skip verification"
		// branch — boot fails instead.
		const EMAIL_WEBHOOK_SECRET = yield* Config.redacted('EMAIL_WEBHOOK_SECRET')
		// No default — the developer must explicitly choose `local-inbox`
		// (dev catcher) or `agentmail` (real send). Forcing the choice
		// prevents local config from silently leaking into prod and vice
		// versa. The .env.example suggests `local-inbox` for local dev.
		const EMAIL_PROVIDER = yield* Config.schema(
			Schema.Literals(['local-inbox', 'agentmail']),
			'EMAIL_PROVIDER',
		)

		// No default — the developer must explicitly opt into a geocoding
		// provider. Nominatim is the only option today; the variable is
		// vendor-neutral so a swap doesn't require renaming.
		const GEOCODER_PROVIDER = yield* Config.schema(
			Schema.Literals(['nominatim']),
			'GEOCODER_PROVIDER',
		)

		// Budget defaults (system-level)
		const RESEARCH_DEFAULT_BUDGET_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_BUDGET_CENTS',
		)
		const RESEARCH_DEFAULT_PAID_BUDGET_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_PAID_BUDGET_CENTS',
		)
		const RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS',
		)
		const RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS = yield* Config.int(
			'RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS',
		)
		const RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS = yield* Config.int(
			'RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS',
		)

		// Concurrency and safety
		const RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL = yield* Config.int(
			'RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL',
		)
		const RESEARCH_MAX_CONCURRENCY_FANOUT = yield* Config.int(
			'RESEARCH_MAX_CONCURRENCY_FANOUT',
		)
		const RESEARCH_CONFIRM_THRESHOLD_FANOUT = yield* Config.int(
			'RESEARCH_CONFIRM_THRESHOLD_FANOUT',
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
			GEOCODER_PROVIDER,
			RESEARCH_DEFAULT_BUDGET_CENTS,
			RESEARCH_DEFAULT_PAID_BUDGET_CENTS,
			RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS,
			RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS,
			RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS,
			RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL,
			RESEARCH_MAX_CONCURRENCY_FANOUT,
			RESEARCH_CONFIRM_THRESHOLD_FANOUT,
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
