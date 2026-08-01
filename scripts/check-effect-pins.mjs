#!/usr/bin/env node
// Every `effect` / `@effect/*` version in the repo must be the same one, in all
// three places it is written down:
//
//   1. the `dependencies` of each workspace package,
//   2. the `overrides:` block in pnpm-workspace.yaml,
//   3. the version pnpm actually resolved, in pnpm-lock.yaml.
//
// An override outranks every package.json entry, so raising only the packages
// leaves the whole repo running the old release while every manifest claims
// otherwise. Nothing else catches that: the lockfile it produces is
// self-consistent, so `--frozen-lockfile` is happy, type-checking is happy, and
// the tests pass — against the version nobody meant to be running. syncpack
// cannot cover it either, because it only ever reads package.json.
//
// Two of the names are pinned to a version that was never published, on purpose
// — see the comment in pnpm-workspace.yaml. Nothing depends on them, so they
// never resolve and never appear in the lockfile, which is why an override is
// allowed to have no lockfile entry.
//
// Usage: pnpm check-effect-pins

import { readdirSync, readFileSync } from 'node:fs'

const MANIFEST_KEYS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
]

const isEffectPackage = name => name === 'effect' || name.startsWith('@effect/')

const workspaceManifests = () => {
	const nested = dir =>
		readdirSync(dir, { withFileTypes: true })
			.filter(entry => entry.isDirectory())
			.map(entry => `${dir}/${entry.name}/package.json`)
	return ['package.json', ...nested('apps'), ...nested('packages')]
}

const problems = []
const seen = new Map()

const record = (version, where) => {
	if (!seen.has(version)) seen.set(version, [])
	seen.get(version).push(where)
}

for (const file of workspaceManifests()) {
	let manifest
	try {
		manifest = JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		continue
	}
	for (const key of MANIFEST_KEYS)
		for (const [name, version] of Object.entries(manifest[key] ?? {}))
			if (isEffectPackage(name)) record(version, `${file} → ${key}.${name}`)
}

// The overrides block ends at the first line that is not an indented entry.
const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')
const overridesBlock = workspace.split(/^overrides:$/m)[1] ?? ''
for (const [, name, version] of overridesBlock.matchAll(
	/^ +'?([@\w/.-]+)'?: *(\S+)$/gm,
))
	if (isEffectPackage(name))
		record(version, `pnpm-workspace.yaml → overrides.${name}`)

// What pnpm actually installed. `specifier` is what a manifest asked for and
// `version` is what won after overrides, so a disagreement between the two is
// exactly the failure this script exists to catch.
const lockfile = readFileSync('pnpm-lock.yaml', 'utf8')
for (const [, name, specifier, resolved] of lockfile.matchAll(
	/^ {6}(effect|@effect\/[\w-]+):\n {8}specifier: (\S+)\n {8}version: (\S+)$/gm,
)) {
	record(specifier, `pnpm-lock.yaml → ${name} (asked for)`)
	// A resolved entry carries its peers in brackets: `4.0.0-beta.102(react@19)`.
	record(resolved.replace(/\(.*$/, ''), `pnpm-lock.yaml → ${name} (installed)`)
}

if (seen.size > 1) {
	// The version most places agree on is almost certainly the intended one, so
	// name the stragglers rather than reprinting everything that is already fine.
	const byCount = [...seen].sort((a, b) => b[1].length - a[1].length)
	const [intended, agreeing] = byCount[0]
	problems.push(
		`Effect is pinned to ${seen.size} different versions. Most of the repo (${agreeing.length} places) says ${intended}; these disagree:`,
	)
	for (const [version, places] of byCount.slice(1))
		for (const place of places) problems.push(`  ${version}  ${place}`)
}

if (problems.length > 0) {
	console.error(problems.join('\n'))
	console.error(
		'\nRaise every one of them together, including the overrides block in\npnpm-workspace.yaml — an override silently outranks a package.json entry.',
	)
	process.exit(1)
}

const [version] = [...seen.keys()]
console.log(
	`Effect pins agree: ${version} (${[...seen.values()][0].length} places)`,
)
