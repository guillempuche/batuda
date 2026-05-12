import { defineConfig } from 'tsdown'

// Bundle the `@batuda/*` workspace packages into the server bundle. Their
// package.json files point `main`/`import` at `./src/index.ts` (raw TS) for
// local-dev consumption via tsx/Vite, which Node.js can't load at runtime.
// Inlining them at build time keeps the runtime image free of workspace
// `node_modules/@batuda/*` entries entirely, while leaving npm dependencies
// (effect, pg, AWS SDK, ...) external as before.
export default defineConfig({
	entry: ['src/main.ts', 'src/mcp-stdio.ts', 'src/db/migrate.ts'],
	format: 'esm',
	noExternal: [/^@batuda\//],
})
