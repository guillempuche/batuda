import { defineConfig } from '@lingui/cli'

/**
 * Forja is English-only for now; `ca` and `es` are reserved so the
 * extractor can generate empty catalogs the moment translators want
 * to start working. `sourceLocale` is what every `<Trans>` / `t\`...\``
 * macro falls back to when a string hasn't been translated yet, so
 * the English text you write in source is also the "English catalog".
 *
 * Catalogs live under `src/locales/{locale}/messages.po`. The
 * companion `@lingui/vite-plugin` in `vite.config.ts` handles
 * importing `.po` files directly from source, so we don't need a
 * separate `lingui compile` step at dev time — the `i18n:compile`
 * script in `package.json` is kept for CI/prod builds where a
 * pre-compiled catalog is preferable.
 */
export default defineConfig({
	sourceLocale: 'en',
	locales: ['en'],
	catalogs: [
		{
			path: '<rootDir>/src/locales/{locale}/messages',
			include: ['src'],
			exclude: ['**/node_modules/**', '**/routeTree.gen.ts'],
		},
	],
})
