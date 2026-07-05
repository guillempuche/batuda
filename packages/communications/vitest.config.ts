import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// `*.integration.test.ts` is opt-in via test:integration — it needs a
		// real Postgres on $DATABASE_URL; see vitest.integration.config.ts.
		exclude: ['src/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
		environment: 'node',
		globals: false,
		// The only spec here is the matcher's integration test (run via
		// test:integration); the domain value types carry no unit-testable logic,
		// so the unit run legitimately has nothing to execute.
		passWithNoTests: true,
		testTimeout: 30_000,
	},
})
