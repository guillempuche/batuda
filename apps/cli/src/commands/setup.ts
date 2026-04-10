import { existsSync, readdirSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { Effect } from 'effect'

const ROOT = resolve(import.meta.dirname, '../../../..')

const SKIP_DIRS = new Set([
	'node_modules',
	'docs',
	'.git',
	'dist',
	'.output',
	'.vinxi',
])

/** Walk the repo tree and return relative paths to every .env.example file. */
const findEnvExamples = (dir: string): string[] => {
	const results: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) {
				results.push(...findEnvExamples(join(dir, entry.name)))
			}
		} else if (entry.name === '.env.example') {
			results.push(relative(ROOT, join(dir, entry.name)))
		}
	}
	return results
}

// ── .env parsing ──────────────────────────────────────────

export type EnvEntry = {
	key: string
	line: string
	/** Comment lines immediately preceding this key (reset by blank lines). */
	comments: string[]
}

export type EnvFileResult = {
	example: string
	target: string
	status: 'created' | 'up-to-date' | 'stale' | 'skipped'
	missing: EnvEntry[]
}

/** Extract the set of defined keys from a .env file. */
const parseEnvKeys = (content: string): Set<string> => {
	const keys = new Set<string>()
	for (const line of content.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq !== -1) keys.add(trimmed.slice(0, eq))
	}
	return keys
}

/** Parse a .env file into entries with preceding comment context. */
const parseEnvEntries = (content: string): EnvEntry[] => {
	const entries: EnvEntry[] = []
	let comments: string[] = []

	for (const raw of content.split('\n')) {
		const trimmed = raw.trim()
		if (trimmed === '') {
			comments = []
			continue
		}
		if (trimmed.startsWith('#')) {
			comments.push(raw)
			continue
		}
		const eq = trimmed.indexOf('=')
		if (eq !== -1) {
			entries.push({
				key: trimmed.slice(0, eq),
				line: raw,
				comments: [...comments],
			})
		}
		comments = []
	}

	return entries
}

// ── Commands ──────────────────────────────────────────────

export const setup: Effect.Effect<EnvFileResult[]> = Effect.gen(function* () {
	const results: EnvFileResult[] = []

	for (const example of findEnvExamples(ROOT)) {
		const target = example.replace(/\.example$/, '')
		const src = resolve(ROOT, example)
		const dst = resolve(ROOT, target)

		if (!existsSync(dst)) {
			yield* Effect.promise(() => copyFile(src, dst))
			results.push({ example, target, status: 'created', missing: [] })
			continue
		}

		const [exampleContent, targetContent] = yield* Effect.all([
			Effect.promise(() => readFile(src, 'utf-8')),
			Effect.promise(() => readFile(dst, 'utf-8')),
		])

		const targetKeys = parseEnvKeys(targetContent)
		const missing = parseEnvEntries(exampleContent).filter(
			e => !targetKeys.has(e.key),
		)

		results.push({
			example,
			target,
			status: missing.length === 0 ? 'up-to-date' : 'stale',
			missing,
		})
	}

	return results
})

/** Append missing entries (with their comments) to an existing .env file. */
export const appendEnvKeys = (targetPath: string, entries: EnvEntry[]) =>
	Effect.promise(async () => {
		const existing = await readFile(targetPath, 'utf-8')
		const block = entries.flatMap(e => [...e.comments, e.line]).join('\n')
		const separator = existing.endsWith('\n') ? '\n' : '\n\n'
		await writeFile(targetPath, `${existing}${separator}${block}\n`)
	})

/** Replace target .env entirely with .env.example content. */
export const resetEnvFile = (exampleRel: string, targetPath: string) =>
	Effect.promise(() => copyFile(resolve(ROOT, exampleRel), targetPath))
