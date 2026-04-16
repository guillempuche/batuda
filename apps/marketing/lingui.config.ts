import { defineConfig } from '@lingui/cli'

/**
 * Marketing ships three user-facing locales. `sourceLocale` is what every
 * `<Trans>` / `t\`...\`` macro falls back to when a string hasn't been
 * translated yet — the English text written in source is also the
 * "English catalog", so `en/messages.po` mostly has empty `msgstr`
 * entries that Lingui resolves to the source text at runtime.
 *
 * `ca` and `es` catalogs are populated by hand (or via a translator
 * workflow) after `pnpm i18n:extract`. The companion
 * `@lingui/vite-plugin` in `vite.config.ts` imports `.po` files
 * directly from source, so we don't need a separate `lingui compile`
 * step at dev time — the `i18n:compile` script in `package.json` is
 * kept for CI/prod builds where a pre-compiled catalog is preferable.
 */
export default defineConfig({
	sourceLocale: 'en',
	locales: ['en', 'ca', 'es'],
	catalogs: [
		{
			path: '<rootDir>/src/locales/{locale}/messages',
			include: ['src'],
			exclude: ['**/node_modules/**', '**/routeTree.gen.ts'],
		},
	],
})
