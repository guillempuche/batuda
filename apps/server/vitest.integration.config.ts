import { defineConfig } from 'vitest/config'

// DB-integration runner — `*.integration.test.ts` files that need a real
// Postgres ($DATABASE_URL) but no other services. CI applies migrations
// against an ephemeral Neon branch and runs this config. Sequential file
// execution because several suites TRUNCATE shared tables in beforeAll
// (notably multi-org-isolation), which races with any parallel suite
// that inserts into the same tables.
export default defineConfig({
	test: {
		include: ['src/**/*.integration.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
		fileParallelism: false,
	},
})
