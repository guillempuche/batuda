const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

function getWorkspacePackages() {
	const dirs = ['apps', 'packages']
	const packages = new Map()

	for (const dir of dirs) {
		const full = path.join(ROOT, dir)
		if (!fs.existsSync(full)) continue
		for (const entry of fs.readdirSync(full)) {
			const pkgPath = path.join(full, entry, 'package.json')
			if (fs.existsSync(pkgPath)) {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
				packages.set(pkg.name, path.join(dir, entry))
			}
		}
	}
	return packages
}

function getWorkspaceDeps(pkgName, packages, visited = new Set()) {
	if (visited.has(pkgName)) return []
	visited.add(pkgName)

	const pkgDir = packages.get(pkgName)
	if (!pkgDir) return []

	const pkgJson = JSON.parse(
		fs.readFileSync(path.join(ROOT, pkgDir, 'package.json'), 'utf8'),
	)

	const deps = [
		...Object.entries(pkgJson.dependencies || {}),
		...Object.entries(pkgJson.devDependencies || {}),
	]
		.filter(([, v]) => v === 'workspace:*' || v.startsWith('workspace:'))
		.map(([name]) => name)

	const paths = []
	for (const dep of deps) {
		if (packages.has(dep)) {
			paths.push(packages.get(dep))
			paths.push(...getWorkspaceDeps(dep, packages, visited))
		}
	}
	return paths
}

function getCommitPathsArray(appDir) {
	const packages = getWorkspacePackages()
	const appPkgJson = JSON.parse(
		fs.readFileSync(path.join(ROOT, appDir, 'package.json'), 'utf8'),
	)
	const depPaths = getWorkspaceDeps(appPkgJson.name, packages)
	return [appDir, ...new Set(depPaths)]
}

function getCommitPaths(appDir) {
	return getCommitPathsArray(appDir).join(',')
}

const changelogPreset = {
	name: 'conventionalcommits',
	types: [
		{ type: 'feat', section: 'Features' },
		{ type: 'fix', section: 'Bug Fixes' },
		{ type: 'refactor', section: 'Refactoring' },
		{ type: 'docs', section: 'Documentation' },
		{ type: 'test', section: 'Tests' },
		{ type: 'cicd', section: 'CI/CD' },
		{ type: 'chore', section: 'Chores' },
		{ type: 'revert', section: 'Reverts' },
		{ type: 'ai', section: 'AI' },
		{ type: 'perf', hidden: true },
	],
}

const changelogHeader =
	'# Changelog\n\nAll notable changes to this project will be documented in this file.\n'

// The release version is the date (YYYY.M.D). A second release on the same day
// gets a "-N" suffix so the base stays a valid 3-segment SemVer, which pnpm's
// workspace resolver requires. This is the single source of truth for the
// version — used by both the release-it version plugin and the changelog
// finalizeContext below, so the two can never disagree.
function computeCalverVersion(latestVersion) {
	const now = new Date()
	const todayPrefix = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`
	if (latestVersion) {
		const match = latestVersion.match(/^(\d+\.\d+\.\d+)(?:-(\d+))?$/)
		if (match && match[1] === todayPrefix) {
			const n = match[2] === undefined ? 1 : parseInt(match[2], 10) + 1
			return `${todayPrefix}-${n}`
		}
	}
	return todayPrefix
}

// The changelog writer fills the header's {{currentTag}} from a standard SemVer
// bump of the last version (a feature is a minor bump), which disagrees with the
// date-based version the release actually tags — so a release with a feature
// previewed the wrong number in the header. This rewrites the render context to
// the date-based version, keeping the header in step with the tag. The previous
// tag (e.g. "server-v2026.7.7-1") supplies both the tag prefix and the version to
// bump from.
function calverFinalizeContext(context) {
	const priorTag = context.previousTag || context.currentTag || ''
	const match = priorTag.match(/^(.*?v)(\d.*)$/)
	if (match) {
		const version = computeCalverVersion(match[2])
		context.version = version
		context.currentTag = `${match[1]}${version}`
	}
	return context
}

// Shared changelog writer options for every target's release config, so the
// header template and the version-alignment fix live in one place.
const changelogWriterOpts = {
	headerPartial: '## {{date}} ({{currentTag}})\n',
	finalizeContext: calverFinalizeContext,
}

module.exports = {
	getCommitPaths,
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
	computeCalverVersion,
	calverFinalizeContext,
	changelogWriterOpts,
}
