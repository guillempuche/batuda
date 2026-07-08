import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { parse as parseEnv } from 'dotenv'

// Vitest globalSetup for the `*.integration.test.ts` suites. Locally it builds a
// disposable `batuda_it` database, migrates it to HEAD, and seeds it — the same
// shape CI gives its fresh Neon branch — and the integration vitest configs
// point DATABASE_URL at it. This keeps the local integration run on the CURRENT
// schema instead of a stale shared dev DB; running the new code against an
// un-migrated schema is exactly what let a dropped-column bug pass pre-push but
// fail CI. In CI, DATABASE_URL is already a migrated + seeded Neon branch, so
// this is a no-op.
//
// `CI` reaches here via turbo `passThroughEnv` (turbo.json → test:integration).

const IT_URL = 'postgresql://batuda:batuda@localhost:5433/batuda_it'

// The `pnpm cli` calls below migrate + seed batuda_it, and the CLI reads its
// credentials (STORAGE_*, auth secrets, …) from the checkout's `.env`. A linked
// worktree created with a bare `git worktree add` has none — only
// `pnpm cli worktree up` writes one — so the seed would die with a ConfigError
// and the pre-push hook couldn't run there at all. Read those values from the
// MAIN checkout's `.env` files (the same source `worktree up` copies from) so
// the setup works in any worktree, provisioned or not. DATABASE_URL is left out
// on purpose: the batuda_it override wins because the CLI keeps an
// explicitly-set env var ahead of any `.env` value. Returns nothing in the main
// checkout, where the CLI already finds its own `.env`.
const mainCheckoutEnv = (): Record<string, string> => {
	try {
		// `--git-common-dir` is the SHARED `.git`, so its parent is the main
		// checkout from any worktree (and the current checkout otherwise).
		const gitCommonDir = execFileSync(
			'git',
			['rev-parse', '--path-format=absolute', '--git-common-dir'],
			{ encoding: 'utf8' },
		).trim()
		const mainRoot = dirname(gitCommonDir)
		const inherited: Record<string, string> = {}
		for (const relativePath of ['.env', 'apps/cli/.env']) {
			const file = resolve(mainRoot, relativePath)
			if (existsSync(file))
				Object.assign(inherited, parseEnv(readFileSync(file)))
		}
		return inherited
	} catch {
		return {}
	}
}

export default function setup(): void {
	if (process.env['CI']) return

	// Main checkout's `.env` first (fills a worktree's missing credentials), then
	// the live shell, then the batuda_it target — later spreads win.
	const itEnv = { ...mainCheckoutEnv(), ...process.env, DATABASE_URL: IT_URL }
	const sh = (cmd: string, env: NodeJS.ProcessEnv = process.env) =>
		execSync(cmd, { stdio: 'inherit', shell: '/bin/bash', env })

	// CREATE DATABASE can't run inside a transaction; ignore "already exists".
	sh(
		`docker exec batuda-db psql -U batuda -d postgres -c "CREATE DATABASE batuda_it" 2>/dev/null || true`,
	)
	// `db reset` migrates to HEAD AND truncates, so a reused batuda_it starts
	// from a clean slate (the seed refuses to run against leftover CRM rows).
	sh('pnpm -w cli db reset', itEnv)
	sh('pnpm -w cli seed', itEnv) // taller/restaurant fixtures the suites rely on
}
