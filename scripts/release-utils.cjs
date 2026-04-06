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

module.exports = {
	getCommitPaths,
	getCommitPathsArray,
	changelogPreset,
	changelogHeader,
}
