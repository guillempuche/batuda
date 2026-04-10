import { lingui } from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

/* Forja uses `@vitejs/plugin-react-swc` instead of the default
 * `@vitejs/plugin-react` so that `@lingui/swc-plugin` can run as part
 * of the SWC transform pipeline. That plugin is what turns
 * `import { Trans } from '@lingui/react/macro'` + `<Trans>Hello</Trans>`
 * into the runtime form with auto-generated message IDs.
 *
 * The earlier plugin-react v6 build dropped its `babel` option, so
 * the SWC path is the only clean way to get Lingui's macro support
 * without reverting to the verbose runtime API. styled-components
 * `displayName` is applied manually via `withConfig({ displayName })`
 * on each styled component (same as before — react-swc doesn't run
 * babel-plugin-styled-components either, so nothing changes there). */
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
			plugins: [['@lingui/swc-plugin', {}]],
		}),
		lingui(),
		tailwindcss(),
	],
})

export default config
