import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

/* Forja uses `@vitejs/plugin-react-swc` so two SWC transforms can run at
 * compile time:
 * - `@lingui/swc-plugin` turns `<Trans>…</Trans>` (from `@lingui/react/macro`)
 *   into the runtime form with auto-generated message IDs.
 * - `@swc/plugin-styled-components` gives every `styled.*` call a stable
 *   `componentId` + `displayName`, so SSR class names match the emitted
 *   `<style data-styled>` rules (otherwise hashes drift and elements fall
 *   back to unstyled defaults). */
const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	ssr: {
		noExternal: ['styled-components'],
	},
	plugins: [
		tanstackStart(),
		viteReact({
			plugins: [
				['@lingui/swc-plugin', {}],
				[
					'@swc/plugin-styled-components',
					{
						displayName: true,
						ssr: true,
						fileName: true,
						pure: false,
						transpileTemplateLiterals: true,
					},
				],
			],
		}),
		lingui(),
		tailwindcss(),
	],
})

export default config
