import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

/* Two SWC transforms run here at compile time:
 * - `@lingui/swc-plugin` turns `<Trans>…</Trans>` (from `@lingui/react/macro`)
 *   into the runtime form with auto-generated message IDs. It runs first so
 *   the styled-components plugin sees the final JSX shape.
 * - `@swc/plugin-styled-components` gives every `styled.*` call a stable
 *   `componentId` + `displayName`. Without this the SSR stylesheet pass
 *   and the render pass drift, producing class names on elements that
 *   don't match the emitted CSS rules (e.g. H1 rendered as `hYisUL`
 *   while its rule is keyed by `cehExt`). */
const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	ssr: {
		noExternal: ['styled-components'],
		resolve: { conditions: ['module', 'import', 'default'] },
	},
	plugins: [
		tanstackStart(),
		nitro(),
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
