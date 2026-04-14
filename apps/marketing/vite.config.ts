import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

/* The SWC React plugin runs `@swc/plugin-styled-components` at compile time
 * so every `styled.*` call gets a stable `componentId` + `displayName`.
 * Without this, the SSR stylesheet-collection pass and the render pass drift,
 * producing class names on elements that don't match the emitted CSS rules
 * (e.g. H1 rendered as `hYisUL` while its rule is keyed by `cehExt`). */
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
		tailwindcss(),
	],
})

export default config
