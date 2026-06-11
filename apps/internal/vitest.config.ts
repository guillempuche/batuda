import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const here = fileURLToPath(new URL('.', import.meta.url))

// Standalone from vite.config.ts on purpose: unit tests cover pure logic
// (schema/search helpers) and don't need the app's SSR/Lingui/styled plugins.
// Only the `#/` path alias is mirrored so `#/lib/*` imports resolve.
export default defineConfig({
	resolve: {
		alias: [{ find: /^#\//, replacement: `${resolve(here, 'src')}/` }],
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		globals: false,
		testTimeout: 30_000,
	},
})
