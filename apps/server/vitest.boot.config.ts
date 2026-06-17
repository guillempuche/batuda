import { defineConfig } from 'vitest/config'

// Opt-in boot-test runner. The default `vitest run` excludes
// `*.boot.test.ts` (slow, spawns the built server, needs all dev
// services up). `pnpm test:boot` flips it on by routing through this
// config. Not run in CI yet — CI has Neon for Postgres but not MinIO or
// GreenMail; see vitest.integration.config.ts for the DB-only bucket that
// does run in CI.
export default defineConfig({
	test: {
		include: ['src/**/*.boot.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 60_000,
		fileParallelism: false,
	},
})
