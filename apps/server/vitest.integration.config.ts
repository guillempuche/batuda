import { defineConfig } from 'vitest/config'

// Opt-in boot-test runner. The default `vitest run` excludes
// `*.boot.test.ts` (slow, requires the dev services fixture and a built
// dist/). `pnpm test:integration` flips it on by routing through this
// config.
export default defineConfig({
	test: {
		include: ['src/**/*.boot.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 60_000,
		fileParallelism: false,
	},
})
