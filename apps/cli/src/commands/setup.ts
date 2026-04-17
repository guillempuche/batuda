import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { Effect } from 'effect'

const ROOT = resolve(import.meta.dirname, '../../../..')

const WORKSPACE_DIRS = ['apps', 'packages'] as const

/**
 * Return repo-relative paths to every `.env.example` (exact name) located at
 * the repo root or one level deep inside `apps/` and `packages/`. Variants
 * like `.env.cloud.example` or `.env.example.github` are intentionally
 * ignored so the sync surface stays narrow.
 */
const findEnvExamples = (): string[] => {
	const results: string[] = []

	const rootExample = join(ROOT, '.env.example')
	if (existsSync(rootExample)) results.push('.env.example')

	for (const workspace of WORKSPACE_DIRS) {
		const workspaceDir = join(ROOT, workspace)
		if (!existsSync(workspaceDir)) continue
		for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue
			const example = join(workspaceDir, entry.name, '.env.example')
			if (existsSync(example) && statSync(example).isFile()) {
				results.push(relative(ROOT, example))
			}
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

	for (const example of findEnvExamples()) {
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
export const appendEnvKeys = (targetRel: string, entries: EnvEntry[]) =>
	Effect.promise(async () => {
		const dst = resolve(ROOT, targetRel)
		const existing = await readFile(dst, 'utf-8')
		const block = entries.flatMap(e => [...e.comments, e.line]).join('\n')
		const separator = existing.endsWith('\n') ? '\n' : '\n\n'
		await writeFile(dst, `${existing}${separator}${block}\n`)
	})

/** Replace target .env entirely with .env.example content. */
export const resetEnvFile = (exampleRel: string, targetRel: string) =>
	Effect.promise(() =>
		copyFile(resolve(ROOT, exampleRel), resolve(ROOT, targetRel)),
	)
