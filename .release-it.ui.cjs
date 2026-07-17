const {
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
	changelogWriterOpts,
} = require('./scripts/release-utils.cjs')

module.exports = {
	extends: './.release-it.base.json',
	git: {
		commitsPath: getCommitPathsArray('packages/ui').join(' '),
		commitMessage: 'cicd(release): ui v${version}',
		tagAnnotation: 'UI Release v${version}',
		tagMatch: 'ui-v[0-9]*.[0-9]*.[0-9]*',
		tagName: 'ui-v${version}',
	},
	github: {
		releaseName: 'UI v${version}',
	},
	hooks: {
		'after:release': "echo '✅ Released ui v${version}'",
	},
	npm: false,
	plugins: {
		'./scripts/release-calver-plugin.cjs': {},
		'@release-it/bumper': {
			in: 'packages/ui/package.json',
			out: ['packages/ui/package.json'],
		},
		'@release-it/conventional-changelog': {
			gitRawCommitsOpts: {
				path: getCommitPathsArray('packages/ui'),
			},
			header: changelogHeader,
			ignoreRecommendedBump: true,
			infile: 'packages/ui/CHANGELOG.md',
			preset: changelogPreset,
			writerOpts: changelogWriterOpts,
		},
	},
}
