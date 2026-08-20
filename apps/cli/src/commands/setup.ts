import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { Effect } from 'effect'

import type { EnvEntry } from '../lib/env-file'
import { missingEnvEntries, tryFs } from '../lib/env-file'
import { ROOT } from '../shell'
import {
	syncWorktreeEnvIfProvisioned,
	WORKTREE_ENV_FILES,
	worktreeContext,
} from './worktree'

const WORKSPACE_DIRS = ['apps', 'packages'] as const

// The paths from `WORKTREE_ENV_FILES` alone, for the generic loop's skip
// check below — kept in sync with `writeWorktreeEnv`'s own list by construction.
const WORKTREE_ENV_TARGETS = new Set(WORKTREE_ENV_FILES.map(f => f.path))

/**
 * Return repo-relative paths to every `.env.example` (exact name) located at
 * the repo root or one level deep inside `apps/` and `packages/`. Variants
 * like `.env.example.pr-media` are intentionally ignored so the sync surface
 * stays narrow.
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

export type EnvFileResult = {
	example: string
	target: string
	status:
		| 'created'
		| 'up-to-date'
		| 'stale'
		| 'skipped'
		| 'worktree-synced'
		| 'worktree-unprovisioned'
		| 'worktree-error'
	missing: EnvEntry[]
	/** Set only for the worktree-* statuses: this worktree's intended database
	 * and/or bucket — only the keys this specific file actually receives. */
	worktree?: { db?: string | undefined; bucket?: string | undefined }
	/** Set only for 'worktree-error': what went wrong repairing this file. */
	error?: string | undefined
}

// ── Commands ──────────────────────────────────────────────

export const setup = Effect.gen(function* () {
	const results: EnvFileResult[] = []
	const { isLinked: inWorktree, main } = yield* worktreeContext

	// Read-only context detection: in a worktree, `.env` + `apps/cli/.env` are
	// repaired from this worktree's own database/bucket (if already provisioned)
	// instead of synced from the template — never created here. `worktree up`
	// remains the only path that provisions.
	if (inWorktree) {
		const sync = yield* syncWorktreeEnvIfProvisioned(main)
		for (const file of WORKTREE_ENV_FILES) {
			results.push({
				example: `${file.path}.example`,
				target: file.path,
				status: sync.error
					? 'worktree-error'
					: sync.synced
						? 'worktree-synced'
						: 'worktree-unprovisioned',
				missing: [],
				worktree: {
					db: file.keys.includes('DATABASE_URL') ? sync.db : undefined,
					bucket: file.keys.includes('STORAGE_BUCKET')
						? sync.bucket
						: undefined,
				},
				error: sync.error,
			})
		}
	}

	for (const example of findEnvExamples()) {
		const target = example.replace(/\.example$/, '')
		if (inWorktree && WORKTREE_ENV_TARGETS.has(target)) continue

		const src = resolve(ROOT, example)
		const dst = resolve(ROOT, target)

		if (!existsSync(dst)) {
			yield* tryFs(`create ${target}`, () => copyFile(src, dst))
			results.push({ example, target, status: 'created', missing: [] })
			continue
		}

		const { exampleContent, targetContent } = yield* Effect.all(
			{
				exampleContent: tryFs(`read ${example}`, () => readFile(src, 'utf-8')),
				targetContent: tryFs(`read ${target}`, () => readFile(dst, 'utf-8')),
			},
			{ concurrency: 'unbounded' },
		)

		const missing = missingEnvEntries(exampleContent, targetContent)

		results.push({
			example,
			target,
			status: missing.length === 0 ? 'up-to-date' : 'stale',
			missing,
		})
	}

	return results
})
