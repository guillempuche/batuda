const {
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
	changelogWriterOpts,
} = require('./scripts/release-utils.cjs')

module.exports = {
	extends: './.release-it.base.json',
	git: {
		commitsPath: getCommitPathsArray('apps/internal').join(' '),
		commitMessage: 'cicd(release): internal v${version}',
		tagAnnotation: 'Internal Release v${version}',
		tagMatch: 'internal-v[0-9]*.[0-9]*.[0-9]*',
		tagName: 'internal-v${version}',
	},
	github: {
		releaseName: 'Internal v${version}',
	},
	hooks: {
		'after:release': "echo '✅ Released internal v${version}'",
	},
	npm: false,
	plugins: {
		'./scripts/release-calver-plugin.cjs': {},
		'@release-it/bumper': {
			in: 'apps/internal/package.json',
			out: 'apps/internal/package.json',
		},
		'@release-it/conventional-changelog': {
			gitRawCommitsOpts: {
				path: getCommitPathsArray('apps/internal'),
			},
			header: changelogHeader,
			ignoreRecommendedBump: true,
			infile: 'apps/internal/CHANGELOG.md',
			preset: changelogPreset,
			writerOpts: changelogWriterOpts,
		},
	},
}
