import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		// Two opt-in buckets are excluded from the fast suite:
		//   - `*.boot.test.ts` (test:boot) needs the full services
		//     fixture (`pnpm cli services up`) plus a built `dist/main.mjs`.
		//   - `*.integration.test.ts` (test:integration) needs only a real
		//     Postgres via $DATABASE_URL — CI applies migrations against a
		//     fresh Neon branch and runs them there.
		exclude: [
			'src/**/*.boot.test.ts',
			'src/**/*.integration.test.ts',
			'node_modules/**',
			'dist/**',
		],
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
