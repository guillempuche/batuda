/** @type {import("syncpack").RcFile} */
export default {
	indent: '\t',
	versionGroups: [
		{
			// A peer range says what a consumer is allowed to bring; a dependency
			// pin says what we install. `@batuda/ui` accepts `@base-ui/react`
			// `^1.3.0` so a consumer on 1.3.0 keeps one copy, while this repo
			// installs 1.6.0. Holding both to one string would force either a
			// hostile exact peer or a loose install pin.
			label: 'Peer ranges, which are broader than install pins',
			dependencies: ['**'],
			dependencyTypes: ['peer'],
			isIgnored: true,
		},
		{
			label: 'TypeScript',
			dependencies: ['typescript'],
		},
		{
			label: 'App versions (independently released)',
			packages: ['@batuda/server', '@batuda/internal', '@batuda/ui'],
			dependencyTypes: ['local'],
			isIgnored: true,
		},
		{
			label: 'Batuda',
			dependencies: ['@batuda/*'],
			policy: 'sameRange',
		},
		{
			label: 'React',
			dependencies: ['react', 'react-dom'],
			isIgnored: true,
		},
		{
			label: 'React types',
			dependencies: ['@types/react*'],
			policy: 'sameRange',
		},
		{
			// A wildcard, so a new `@effect/*` package joins the group by existing
			// rather than by someone remembering to list it here. This only sees
			// package.json; the overrides block in pnpm-workspace.yaml outranks all
			// of it and is checked by scripts/check-effect-pins.mjs.
			label: 'Effect',
			dependencies: ['effect', '@effect/*'],
			policy: 'sameRange',
		},
		{
			label: 'TanStack',
			dependencies: ['@tanstack/*'],
			policy: 'sameRange',
		},
		{
			label: 'Testing',
			dependencies: ['vitest', '@vitest/*', '@testing-library/*'],
			policy: 'sameRange',
		},
	],
	sortAz: [
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'resolutions',
	],
	sortExports: [
		'development',
		'production',
		'types',
		'browser',
		'module',
		'node-addons',
		'node',
		'import',
		'require',
		'default',
	],
	sortFirst: [
		'name',
		'version',
		'description',
		'type',
		'types',
		'module',
		'main',
		'exports',
		'engines',
		'scripts',
		'dependencies',
		'peerDependencies',
		'devDependencies',
		'resolutions',
		'private',
	],
	sortPackages: true,
	source: ['package.json', 'apps/*/package.json', 'packages/*/package.json'],
}
