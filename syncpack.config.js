/** @type {import("syncpack").RcFile} */
export default {
	indent: '\t',
	versionGroups: [
		{
			label: 'TypeScript',
			dependencies: ['typescript'],
		},
		{
			label: 'Engranatge',
			dependencies: ['@engranatge/*'],
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
			label: 'Effect',
			dependencies: [
				'effect',
				'@effect/platform-node',
				'@effect/platform-node-shared',
				'@effect/sql-pg',
			],
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
