import { defineConfig } from 'vitest/config'

// DB-integration runner — `*.integration.test.ts` files that need a real
// Postgres ($DATABASE_URL). Sequential file execution because integration
// suites across workspaces (notably apps/server's multi-org-isolation)
// TRUNCATE shared tables in beforeAll; running parallel files races
// fixture inserts against the truncate. CI runs this against an ephemeral
// Neon branch.
export default defineConfig({
	test: {
		include: ['src/**/*.integration.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
		fileParallelism: false,
	},
})
