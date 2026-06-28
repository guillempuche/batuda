import { defineConfig } from 'vitest/config'

// DB-integration runner — `*.integration.test.ts` files that need a real
// Postgres ($DATABASE_URL). `globalSetup` builds a disposable, HEAD-migrated +
// seeded `batuda_it` DB locally (no-op in CI, which supplies a fresh Neon
// branch), so the suite runs against the current schema, not a stale shared dev
// DB. Sequential file execution because suites across workspaces (notably
// apps/server's multi-org-isolation) TRUNCATE shared tables in beforeAll;
// parallel files race fixture inserts against the truncate.
export default defineConfig({
	test: {
		include: ['src/**/*.integration.test.ts'],
		globalSetup: ['../../scripts/integration-db-setup.ts'],
		env: {
			DATABASE_URL: process.env['CI']
				? (process.env['DATABASE_URL'] ?? '')
				: 'postgresql://batuda:batuda@localhost:5433/batuda_it',
		},
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
		fileParallelism: false,
	},
})
