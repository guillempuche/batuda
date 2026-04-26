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

		// Local-inbox is the only provider during the BYO-mailbox migration;
		// real outbound SMTP / inbound IMAP transport ships in the mail-worker
		// slice. Kept as a literal schema so the variable shape is stable when
		// new transports are added.
		const EMAIL_PROVIDER = yield* Config.schema(
			Schema.Literals(['local-inbox']),
			'EMAIL_PROVIDER',
		)
		// AES-256-GCM master key for encrypting per-inbox IMAP/SMTP
		// credentials at rest. Base64-encoded 32 bytes. Per-inbox subkeys
		// are derived via HKDF-SHA256 with the inbox id as `info`, so a
		// row-level leak doesn't compromise other rows without this key.
		// Required, no default — boot fails rather than ship plaintext.
		// Generate with: node -e "console.log(crypto.randomBytes(32).toString('base64'))"
		const EMAIL_CREDENTIAL_KEY = yield* Config.redacted('EMAIL_CREDENTIAL_KEY')

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
			EMAIL_PROVIDER,
			EMAIL_CREDENTIAL_KEY,
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
