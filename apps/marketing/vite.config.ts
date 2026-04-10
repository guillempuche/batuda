import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

/* `@vitejs/plugin-react` v6 dropped the `babel` option in favour of
 * oxc/rolldown transforms, so `babel-plugin-styled-components` no longer
 * runs here. The `displayName: true` behaviour we used to get from it is
 * applied manually via `withConfig({ displayName: 'X' })` on each styled
 * component — see e.g. `components/layout/section.tsx`. */
const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	ssr: {
		noExternal: ['styled-components'],
		resolve: { conditions: ['module', 'import', 'default'] },
	},
	plugins: [tanstackStart(), nitro(), viteReact(), tailwindcss()],
})

export default config
