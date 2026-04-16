import { defineConfig } from '@lingui/cli'

/**
 * Forja serves English and Catalan. The UI runtime (`src/i18n.ts`)
 * activates `en` at module init and keeps serving English until the
 * `ca` catalog is populated and a language selector is wired up —
 * extraction is ahead of rendering so translators can start working
 * without blocking product. `sourceLocale` is what every `<Trans>` /
 * `t\`...\`` macro falls back to when a string hasn't been translated,
 * so the English text written in source is also the "English catalog".
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
	locales: ['en', 'ca'],
	catalogs: [
		{
			path: '<rootDir>/src/locales/{locale}/messages',
			include: ['src'],
			exclude: ['**/node_modules/**', '**/routeTree.gen.ts'],
		},
	],
})
