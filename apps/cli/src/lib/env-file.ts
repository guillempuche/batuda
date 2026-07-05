import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Effect } from 'effect'

import { ROOT } from '../shell'

// Shared .env parsing/merging/writing helpers. `setup` (template sync) and
// `worktree` (per-worktree override) both call these instead of keeping their
// own copies, so the two commands can't drift into writing a `.env` neither
// one intends.

export type EnvEntry = {
	key: string
	line: string
	/** Comment lines immediately preceding this key (reset by blank lines). */
	comments: string[]
}

/** Every declared key in a .env file's body (comments and blank lines ignored). */
export const parseEnvKeys = (body: string): Set<string> => {
	const keys = new Set<string>()
	for (const line of body.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq !== -1) keys.add(trimmed.slice(0, eq))
	}
	return keys
}

/** Parse a .env file into entries, each with the comment lines immediately above it. */
export const parseEnvEntries = (body: string): EnvEntry[] => {
	const entries: EnvEntry[] = []
	let comments: string[] = []

	for (const raw of body.split('\n')) {
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

/** Entries `exampleBody` declares that `currentBody` doesn't have — e.g. a
 * `.env.example` key never copied into the real `.env`. */
export const missingEnvEntries = (
	exampleBody: string,
	currentBody: string,
): EnvEntry[] => {
	const present = parseEnvKeys(currentBody)
	return parseEnvEntries(exampleBody).filter(e => !present.has(e.key))
}

/** Rewrite matching keys in a .env body, appending any that weren't present, so
 * every other line is preserved as-is. Used to layer per-worktree overrides
 * (`DATABASE_URL`, `STORAGE_BUCKET`) onto a copy of another `.env`'s content. */
export const mergeEnvOverrides = (
	base: string,
	overrides: Record<string, string>,
): string => {
	const remaining = new Set(Object.keys(overrides))
	const lines = base.split('\n').map(line => {
		const match = line.match(/^([A-Z0-9_]+)=/)
		const key = match?.[1]
		if (key && key in overrides) {
			remaining.delete(key)
			return `${key}=${overrides[key]}`
		}
		return line
	})
	for (const key of remaining) lines.push(`${key}=${overrides[key]}`)
	return lines.join('\n')
}

/** Run a fallible fs promise as a proper Effect failure, not a defect —
 * `Effect.promise` is for promises that never reject, but Node's fs calls
 * reject on ENOENT/EACCES/etc, so wrapping them there would turn an ordinary,
 * reportable error into an unrecoverable defect instead. */
export const tryFs = <A>(context: string, fn: () => Promise<A>) =>
	Effect.tryPromise({
		try: fn,
		catch: error => new Error(`${context}: ${String(error)}`),
	})

/** Append missing entries (with their comments) to an existing .env file.
 * `targetRel` is repo-relative, matching `findEnvExamples`'s output. */
export const appendEnvKeys = (targetRel: string, entries: EnvEntry[]) =>
	tryFs(`append keys to ${targetRel}`, async () => {
		const dst = resolve(ROOT, targetRel)
		const existing = await readFile(dst, 'utf-8')
		const block = entries.flatMap(e => [...e.comments, e.line]).join('\n')
		const separator = existing.endsWith('\n') ? '\n' : '\n\n'
		await writeFile(dst, `${existing}${separator}${block}\n`)
	})

/** Replace target .env entirely with .env.example content. Both paths are
 * repo-relative, matching `findEnvExamples`'s output. */
export const resetEnvFile = (exampleRel: string, targetRel: string) =>
	tryFs(`reset ${targetRel} from ${exampleRel}`, () =>
		copyFile(resolve(ROOT, exampleRel), resolve(ROOT, targetRel)),
	)
