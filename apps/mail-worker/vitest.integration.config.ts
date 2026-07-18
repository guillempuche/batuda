import { defineConfig } from 'vitest/config'

import { integrationDbUrl } from '../../scripts/integration-db'

// DB-integration runner — `*.integration.test.ts` files that need a real
// Postgres ($DATABASE_URL). `globalSetup` builds a disposable, HEAD-migrated +
// seeded integration DB locally, named per checkout (`batuda_it`, or
// `batuda_it__<slug>` in a worktree) so parallel worktrees don't race on one
// shared DB — a no-op in CI, which points DATABASE_URL at its own migrated
// Postgres. So the suite runs against the current schema, not a stale shared dev
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
				: integrationDbUrl(),
		},
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
		fileParallelism: false,
	},
})
