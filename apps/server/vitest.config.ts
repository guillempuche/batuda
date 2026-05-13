import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// `*.boot.test.ts` is opt-in via the `test:integration` script —
		// requires the local services fixture (`pnpm cli services up`) and
		// a pre-built `dist/main.mjs`, so we keep it out of the fast suite.
		exclude: ['src/**/*.boot.test.ts', 'node_modules/**', 'dist/**'],
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
		// Serialise test files. Several integration tests share a real
		// Postgres and TRUNCATE / re-seed in beforeAll (notably
		// `multi-org-isolation.test.ts`); running them in parallel races
		// fixture inserts against the truncate. Sequential files keep the
		// suite deterministic at the cost of ~1× wall time.
		fileParallelism: false,
	},
})
