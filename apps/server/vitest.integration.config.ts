import { defineConfig } from 'vitest/config'

// DB-integration runner — `*.integration.test.ts` files that need a real
// Postgres ($DATABASE_URL) but no other services. `globalSetup` builds a
// disposable, HEAD-migrated + seeded `batuda_it` DB locally (no-op in CI, which
// supplies a fresh Neon branch), so the suite always runs against the current
// schema rather than a stale shared dev DB. Sequential file execution because
// several suites TRUNCATE shared tables in beforeAll (notably
// multi-org-isolation), which races with any parallel suite that inserts.
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
