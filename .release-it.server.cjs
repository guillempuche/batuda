const {
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
} = require('./scripts/release-utils.cjs')

module.exports = {
	extends: './.release-it.base.json',
	git: {
		commitsPath: 'apps/server',
		commitMessage: 'cicd(release): server v${version}',
		tagAnnotation: 'Server Release v${version}',
		tagMatch: 'server-v[0-9]*.[0-9]*.[0-9]*',
		tagName: 'server-v${version}',
	},
	github: {
		releaseName: 'Server v${version}',
	},
	hooks: {
		'after:release': "echo '✅ Released server v${version}'",
	},
	npm: false,
	plugins: {
		'./scripts/release-calver-plugin.cjs': {},
		'@release-it/bumper': {
			in: 'apps/server/package.json',
			out: 'apps/server/package.json',
		},
		'@release-it/conventional-changelog': {
			gitRawCommitsOpts: {
				path: getCommitPathsArray('apps/server'),
			},
			header: changelogHeader,
			ignoreRecommendedBump: true,
			infile: 'apps/server/CHANGELOG.md',
			preset: changelogPreset,
			writerOpts: {
				headerPartial: '## {{date}} ({{currentTag}})\n',
			},
		},
	},
}
