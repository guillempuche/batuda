import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		/* One entry per component file, not just the barrel. A barrel emitted as
		 * a single module cannot be tree-shaken — every `styled()` call in it
		 * reads as side-effectful — so naming two components pulls all of them.
		 * Separate modules leave each barrel a thin re-export a consumer can
		 * shake. Globbed, not listed, so a new file needs no change here. */
		'blocks/index': 'src/blocks/index.ts',
		'blocks/*': ['src/blocks/*.ts', '!src/blocks/index.ts'],
		'layout/index': 'src/layout/index.ts',
		'layout/*': 'src/layout/*.tsx',
		'pri/index': 'src/pri/index.ts',
		'pri/*': 'src/pri/*.tsx',
	},
	format: ['esm'],
	dts: true,
	/* Holds `exports` to what the build actually wrote — otherwise a published
	 * subpath can name a module that is not in the tarball. */
	publint: true,
})
