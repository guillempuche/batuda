import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	ssr: {
		noExternal: ['styled-components'],
	},
	plugins: [tanstackStart(), viteReact(), tailwindcss()],
})

export default config
