import {
	Config,
	ConfigProvider,
	Effect,
	Layer,
	Schema,
	ServiceMap,
} from 'effect'

/**
 * Returns the first ALLOWED_ORIGINS pattern that uses a wildcard
 * subdomain whose suffix is NOT under `.localhost`, or `null` if every
 * pattern is safe. Production origins must be listed explicitly so a
 * misconfigured deploy can't grant CORS + Better-Auth trust to every
 * subdomain of an externally-resolvable apex.
 */
export function findUnsafeWildcardOrigin(
	patterns: ReadonlyArray<string>,
): string | null {
	for (const pattern of patterns) {
		const wildcardAt = pattern.indexOf('://*.')
		if (wildcardAt === -1) continue
		const suffix = pattern.slice(wildcardAt + '://*.'.length)
		if (suffix === 'localhost') continue
		if (suffix.endsWith('.localhost')) continue
		return pattern
	}
	return null
}

/**
 * Builds the absolute accept-invitation URL Better Auth redirects to after a
 * magic-link verify. Takes the public origin explicitly so it can't drift
 * with ALLOWED_ORIGINS ordering — reordering that list never retargets an
 * invite link at the wrong product.
 */
export function buildInvitationCallbackURL(
	publicUrl: string,
	invitationId: string,
): string {
	return `${publicUrl.replace(/\/$/, '')}/accept-invitation/${invitationId}`
}

/**
 * Returns an explanatory message if `publicUrl` is not one of
 * `allowedOrigins`, else `null`. APP_PUBLIC_URL must be a trusted origin so
 * the links the server mints can't point at a host it won't serve.
 */
export function findPublicUrlNotAllowed(
	publicUrl: string,
	allowedOrigins: ReadonlyArray<string>,
): string | null {
	if (allowedOrigins.includes(publicUrl)) return null
	return (
		`APP_PUBLIC_URL "${publicUrl}" is not one of ALLOWED_ORIGINS ` +
		`[${allowedOrigins.join(', ')}]. List it there so the app trusts it.`
	)
}

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
		// Defaults to `strict` (Better Auth's tight per-endpoint defaults).
		// Set to `loose` in dev so the e2e suite, which stacks ~20 sign-ins
		// in a single 60s window, doesn't trip the brute-force gate. Must
		// stay strict in prod.
		const BETTER_AUTH_RATE_LIMIT = yield* Config.schema(
			Schema.Literals(['strict', 'loose']),
			'BETTER_AUTH_RATE_LIMIT',
		).pipe(Config.withDefault('strict' as const))
		// How long an OAuth access token (the credential a connected AI
		// assistant calls /mcp with) stays valid, in seconds. Defaults short
		// so production keeps the window a leaked or post-offboarding token
		// works to a few minutes — the per-call org-membership check is the
		// instant cut-off, this just caps the edges. Dev sets it long so local
		// testing isn't constantly re-authorizing.
		const OAUTH_ACCESS_TOKEN_TTL_SECONDS = yield* Config.int(
			'OAUTH_ACCESS_TOKEN_TTL_SECONDS',
		).pipe(Config.withDefault(900))
		// Anyone can register an OAuth client (open Dynamic Client Registration),
		// so abandoned ones get garbage-collected after each registration: a
		// client older than this many days with no consent is deleted. Short in
		// prod; dev sets it long so a client registered while testing survives.
		const OAUTH_CLIENT_GC_DAYS = yield* Config.int('OAUTH_CLIENT_GC_DAYS').pipe(
			Config.withDefault(7),
		)
		// Per-key rate limit for org-scoped API keys — the credential AI/MCP
		// clients call /mcp with. Enabled in prod so a leaked or runaway key
		// can't hammer the API unthrottled; dev sets ENABLED=false so local MCP
		// testing (which fans out many tool calls per turn) never hits a false
		// rejection. MAX requests per WINDOW_SECONDS, stamped on each key at
		// creation. Defaults are generous (600/60s ≈ 10 req/s) — they bound
		// abuse, not normal use; tune per environment.
		const API_KEY_RATE_LIMIT_ENABLED = yield* Config.boolean(
			'API_KEY_RATE_LIMIT_ENABLED',
		).pipe(Config.withDefault(true))
		const API_KEY_RATE_LIMIT_MAX = yield* Config.int(
			'API_KEY_RATE_LIMIT_MAX',
		).pipe(Config.withDefault(600))
		const API_KEY_RATE_LIMIT_WINDOW_SECONDS = yield* Config.int(
			'API_KEY_RATE_LIMIT_WINDOW_SECONDS',
		).pipe(Config.withDefault(60))
		// Comma-separated list of trusted origins (e.g.
		// `https://batuda.localhost`). Each entry is either a literal
		// origin matched exactly or a wildcard-subdomain pattern
		// `https://*.host`. Wildcards are accepted only when the suffix
		// ends in `.localhost` — production hosts (`*.example.com`) are
		// rejected at boot to avoid shipping a broad subdomain-trust hole.
		// Same array is reused as Better-Auth `trustedOrigins`.
		const ALLOWED_ORIGINS = yield* Config.string('ALLOWED_ORIGINS').pipe(
			Config.withDefault(''),
			Config.map(s => (s ? s.split(',').map(o => o.trim()) : [])),
			Config.mapOrFail(patterns => {
				const offending = findUnsafeWildcardOrigin(patterns)
				if (offending !== null) {
					return Effect.fail(
						new Config.ConfigError(
							new ConfigProvider.SourceError({
								message:
									`ALLOWED_ORIGINS rejects wildcard pattern "${offending}": ` +
									'wildcard subdomains are only allowed under .localhost. ' +
									'List each production origin explicitly.',
							}),
						),
					)
				}
				return Effect.succeed(patterns)
			}),
		)

		// Canonical public origin for the links the server mints (invitation
		// callback URLs). Required, no default — like BETTER_AUTH_BASE_URL — and
		// validated to be one of ALLOWED_ORIGINS so an invite can't point at an
		// origin the app doesn't trust. Decoupled from ALLOWED_ORIGINS ordering
		// on purpose: reordering that list no longer moves invite links.
		const APP_PUBLIC_URL = yield* Config.string('APP_PUBLIC_URL')
		const publicUrlError = findPublicUrlNotAllowed(
			APP_PUBLIC_URL,
			ALLOWED_ORIGINS,
		)
		if (publicUrlError !== null) {
			return yield* Effect.fail(
				new Config.ConfigError(
					new ConfigProvider.SourceError({ message: publicUrlError }),
				),
			)
		}

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
			BETTER_AUTH_RATE_LIMIT,
			OAUTH_ACCESS_TOKEN_TTL_SECONDS,
			OAUTH_CLIENT_GC_DAYS,
			API_KEY_RATE_LIMIT_ENABLED,
			API_KEY_RATE_LIMIT_MAX,
			API_KEY_RATE_LIMIT_WINDOW_SECONDS,
			ALLOWED_ORIGINS,
			APP_PUBLIC_URL,
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
