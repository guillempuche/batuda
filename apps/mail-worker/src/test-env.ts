// Shared start-up settings for the mail worker's integration tests. The worker
// reads every one of these before it gets anywhere and none carry a default, so
// a suite that sets only some stops on the first one missing — with an error
// about that setting rather than about what it was testing. `??=` so CI or a
// caller can own any single value outright.

export const TEST_ENV: Record<string, string> = {
	NODE_ENV: 'test',
	MIN_LOG_LEVEL: 'Info',
	DATABASE_URL: 'postgresql://batuda:batuda@localhost:5433/batuda',
	STORAGE_ENDPOINT: 'http://localhost:9000',
	STORAGE_REGION: 'auto',
	STORAGE_ACCESS_KEY_ID: 'batuda',
	STORAGE_SECRET_ACCESS_KEY: 'batuda-secret',
	STORAGE_BUCKET: 'batuda-assets',
	EMAIL_CREDENTIAL_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
}

export const applyTestEnv = (): void => {
	for (const [key, value] of Object.entries(TEST_ENV))
		process.env[key] ??= value
}
