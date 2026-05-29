// Shared env preflight for the server's integration tests. Config carries no
// defaults (every var is required), so each suite must populate the full set
// before any layer reads it — `applyTestEnv()` does that. `??=` lets CI or a
// caller override an individual value. Not a test file itself; imported by the
// `*.integration.test.ts` suites.

export const TEST_ENV: Record<string, string> = {
	NODE_ENV: 'test',
	PORT: '3010',
	MIN_LOG_LEVEL: 'Info',
	DATABASE_URL: 'postgres://batuda:batuda@localhost:5433/batuda',
	BETTER_AUTH_SECRET: '00000000000000000000000000000000',
	BETTER_AUTH_BASE_URL: 'http://localhost:3010',
	BETTER_AUTH_INSECURE_COOKIES: 'false',
	BETTER_AUTH_RATE_LIMIT: 'loose',
	OAUTH_ACCESS_TOKEN_TTL_SECONDS: '86400',
	OAUTH_CLIENT_GC_DAYS: '365',
	API_KEY_RATE_LIMIT_ENABLED: 'true',
	API_KEY_RATE_LIMIT_MAX: '600',
	API_KEY_RATE_LIMIT_WINDOW_SECONDS: '60',
	ALLOWED_ORIGINS: 'http://localhost:3010',
	APP_PUBLIC_URL: 'http://localhost:3010',
	STORAGE_ENDPOINT: 'http://localhost:9000',
	STORAGE_REGION: 'auto',
	STORAGE_ACCESS_KEY_ID: 'batuda',
	STORAGE_SECRET_ACCESS_KEY: 'batuda-secret',
	STORAGE_BUCKET: 'batuda-assets',
	EMAIL_PROVIDER: 'local-inbox',
	EMAIL_CREDENTIAL_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
	EMAIL_PROVIDER_TRANSACTIONAL: 'local',
	EMAIL_HEALTH_PROBE_INTERVAL_SEC: '900',
	GEOCODER_PROVIDER: 'nominatim',
	RESEARCH_PROVIDER_SEARCH: 'stub',
	RESEARCH_PROVIDER_SCRAPE: 'stub',
	RESEARCH_PROVIDER_EXTRACT: 'stub',
	RESEARCH_PROVIDER_DISCOVER: 'stub',
	RESEARCH_PROVIDER_REGISTRY_ES: 'stub',
	RESEARCH_PROVIDER_REPORT_ES: 'none',
	RESEARCH_LLM_AGENT_PROVIDERS: 'stub',
	RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
	RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
	RESEARCH_DEFAULT_BUDGET_CENTS: '100',
	RESEARCH_DEFAULT_PAID_BUDGET_CENTS: '500',
	RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS: '200',
	RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS: '2000',
	RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS: '10000',
	RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL: '3',
	RESEARCH_MAX_CONCURRENCY_FANOUT: '3',
	RESEARCH_CONFIRM_THRESHOLD_FANOUT: '10',
}

export const applyTestEnv = (): void => {
	for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] ??= v
}
