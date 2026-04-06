const {
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
} = require('./scripts/release-utils.cjs')

module.exports = {
	extends: './.release-it.base.json',
	git: {
		commitsPath: 'apps/marketing',
		commitMessage: 'cicd(release): marketing v${version}',
		tagAnnotation: 'Marketing Release v${version}',
		tagMatch: 'marketing-v[0-9]*.[0-9]*.[0-9]*',
		tagName: 'marketing-v${version}',
	},
	github: {
		releaseName: 'Marketing v${version}',
	},
	hooks: {
		'after:release': "echo '✅ Released marketing v${version}'",
	},
	npm: false,
	plugins: {
		'./scripts/release-calver-plugin.cjs': {},
		'@release-it/bumper': {
			in: 'apps/marketing/package.json',
			out: 'apps/marketing/package.json',
		},
		'@release-it/conventional-changelog': {
			gitRawCommitsOpts: {
				path: getCommitPathsArray('apps/marketing'),
			},
			header: changelogHeader,
			ignoreRecommendedBump: true,
			infile: 'apps/marketing/CHANGELOG.md',
			preset: changelogPreset,
			writerOpts: {
				headerPartial: '## {{date}} ({{currentTag}})\n',
			},
		},
	},
}
