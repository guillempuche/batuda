import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'blocks/index': 'src/blocks/index.ts',
		'layout/index': 'src/layout/index.ts',
		'pri/index': 'src/pri/index.ts',
	},
	format: ['esm'],
	dts: true,
	copy: ['src/tokens.css', 'src/tailwind.css'],
})
