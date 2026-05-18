import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// `*.integration.test.ts` is opt-in via test:integration — needs
		// $DATABASE_URL and shares a Neon branch with the server suite in
		// CI; see vitest.integration.config.ts.
		exclude: ['src/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
	},
})
