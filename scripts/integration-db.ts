import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The pre-push integration suite runs against a disposable Postgres database that
// scripts/integration-db-setup.ts creates, migrates, and seeds. It is named PER
// CHECKOUT so two git worktrees running the suite at once don't race on one shared
// database — one worktree's `beforeAll` TRUNCATE wiping rows the other is mid-test
// on (issue #295). The name is derived from the checkout's own dev database (the
// one its `.env` DATABASE_URL points at, which `pnpm cli worktree up` writes): the
// main checkout's `batuda` yields the historical `batuda_it`; a worktree's
// `batuda_<slug>` yields `batuda_it__<slug>`.
//
// The DOUBLE underscore is load-bearing: a dev database name can never contain
// `__` (the slug generator collapses runs of `-`, then maps `-` to `_`), so the
// `batuda_it__` prefix keeps every worktree's integration database out of the
// dev-database namespace. Without it a branch slug like `it-foo` would map to a dev
// database equal to another checkout's integration database, and the suite's
// `db reset` (migrate + TRUNCATE) would silently wipe live dev data. apps/cli's
// worktree.ts and .claude/hooks/worktree-down.sh mirror this rule (a pure string
// transform can't be shared across the TS/bash boundary) so teardown and prune drop
// and protect the integration database alongside the dev database it belongs to.

const HOST = 'postgresql://batuda:batuda@localhost:5433'

// The integration database that belongs to a given dev database. Splices `it` in
// after the `batuda_` prefix: `batuda` -> `batuda_it`, `batuda_x` -> `batuda_it__x`.
export const integrationDbFromDevDb = (devDb: string): string =>
	devDb === 'batuda' ? 'batuda_it' : devDb.replace(/^batuda_/, 'batuda_it__')

const git = (...args: string[]): string | null => {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim()
	} catch {
		return null
	}
}

// The dev database this checkout's own `.env` points at, parsed from DATABASE_URL
// with the SAME last-path-segment regex identityFromEnv uses in worktree.ts, so the
// name the suite CREATEs matches the one teardown later DROPs. Returns null unless
// DATABASE_URL names a clean `batuda*` identifier — a hand-pointed or malformed URL
// must never drive the destructive `db reset`, and the strict `[a-z0-9_]` shape
// guarantees the resolved name is safe to interpolate into the `CREATE DATABASE`
// shell command (no injection from a crafted `.env`).
const devDbFromEnv = (): string | null => {
	const root = git('rev-parse', '--show-toplevel')
	if (!root) return null
	const envPath = resolve(root, '.env')
	if (!existsSync(envPath)) return null
	const url = readFileSync(envPath, 'utf8')
		.match(/^DATABASE_URL=(.+)$/m)?.[1]
		?.trim()
	const db = url?.match(/\/([^/?]+)(?:\?|$)/)?.[1]
	return db && /^batuda[a-z0-9_]*$/.test(db) ? db : null
}

// Postgres caps identifiers at 63 bytes; `batuda_it__` is 11, leaving 52 for the
// suffix. Dev-database-derived names are already within budget (their slug is
// capped tighter); only the bare-worktree fallback below needs trimming.
const MAX_SUFFIX = 52

// The integration database a worktree uses before it is provisioned, keyed off its
// registered git-worktree name (`<main>/.git/worktrees/<name>`) and sanitized to a
// valid, collision-free identifier. A worktree directory is usually named for its
// branch but need not be, so this name and the `.env`-derived one above are
// generally DIFFERENT — a worktree that ran the suite before `pnpm cli worktree up`
// therefore owns one of each over its life, and teardown has to drop both. apps/cli's
// worktree.ts and .claude/hooks/worktree-down.sh mirror this for exactly that reason.
export const integrationDbFromWorktreeName = (name: string): string => {
	const suffix = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, MAX_SUFFIX)
	return suffix ? `batuda_it__${suffix}` : 'batuda_it'
}

// A bare `git worktree add` (never `pnpm cli worktree up`) has no `.env`, so key the
// name off the registered git-worktree name instead, so even an unprovisioned
// worktree stays off the main checkout's `batuda_it`. The main checkout's git dir
// has no `/worktrees/` segment, so it falls through to the shared `batuda_it`.
const nameFromGitWorktree = (): string => {
	const gitDir = git(
		'rev-parse',
		'--path-format=absolute',
		'--absolute-git-dir',
	)
	const name = gitDir?.match(/\/worktrees\/([^/]+)\/?$/)?.[1]
	return name ? integrationDbFromWorktreeName(name) : 'batuda_it'
}

// The integration database name for the current checkout.
export const resolveIntegrationDbName = (): string => {
	const devDb = devDbFromEnv()
	return devDb ? integrationDbFromDevDb(devDb) : nameFromGitWorktree()
}

export const integrationDbUrl = (): string =>
	`${HOST}/${resolveIntegrationDbName()}`
