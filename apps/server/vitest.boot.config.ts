import { defineConfig } from 'vitest/config'

// Opt-in boot-test runner. The default `vitest run` excludes
// `*.boot.test.ts` (slow, spawns the built server, needs all dev
// services up). `pnpm test:boot` flips it on by routing through this
// config, and CI runs it on every pull request as the deploy-parity check:
// it is what catches a setting the running server needs but the deploy never
// passes it.
export default defineConfig({
	test: {
		include: ['src/**/*.boot.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 60_000,
		fileParallelism: false,
	},
})
