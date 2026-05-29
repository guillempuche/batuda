import { defineConfig } from 'tsdown'

// Bundle the `@batuda/*` workspace packages into the bundle: their package.json
// `exports` point at raw `./src/*.ts` for tsx/Vite dev, which Node can't load
// from node_modules at runtime (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
// npm dependencies (effect, pg, imapflow, ...) stay external.
export default defineConfig({
	entry: ['src/main.ts'],
	format: 'esm',
	noExternal: [/^@batuda\//],
})
