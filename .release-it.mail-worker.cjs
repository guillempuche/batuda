const {
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
} = require('./scripts/release-utils.cjs')

module.exports = {
	extends: './.release-it.base.json',
	git: {
		commitsPath: 'apps/mail-worker',
		commitMessage: 'cicd(release): mail-worker v${version}',
		tagAnnotation: 'Mail-worker Release v${version}',
		tagMatch: 'mail-worker-v[0-9]*.[0-9]*.[0-9]*',
		tagName: 'mail-worker-v${version}',
	},
	github: {
		releaseName: 'Mail-worker v${version}',
	},
	hooks: {
		'after:release': "echo '✅ Released mail-worker v${version}'",
	},
	npm: false,
	plugins: {
		'./scripts/release-calver-plugin.cjs': {},
		'@release-it/bumper': {
			in: 'apps/mail-worker/package.json',
			out: 'apps/mail-worker/package.json',
		},
		'@release-it/conventional-changelog': {
			gitRawCommitsOpts: {
				path: getCommitPathsArray('apps/mail-worker'),
			},
			header: changelogHeader,
			ignoreRecommendedBump: true,
			infile: 'apps/mail-worker/CHANGELOG.md',
			preset: changelogPreset,
			writerOpts: {
				headerPartial: '## {{date}} ({{currentTag}})\n',
			},
		},
	},
}
