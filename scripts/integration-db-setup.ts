import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { parse as parseEnv } from 'dotenv'

import { integrationDbUrl, resolveIntegrationDbName } from './integration-db'

// Vitest globalSetup for the `*.integration.test.ts` suites. Locally it builds a
// disposable, HEAD-migrated + seeded integration database and the integration
// vitest configs point DATABASE_URL at it, so the run is always on the CURRENT
// schema instead of a stale shared dev DB — running new code against an
// un-migrated schema is exactly what let a dropped-column bug pass pre-push but
// fail CI. The database is named PER CHECKOUT (`batuda_it` in the main checkout,
// `batuda_it__<slug>` in a worktree — see ./integration-db) so two worktrees
// running the suite at once don't race on one shared database.
//
// In CI this is a no-op: CI points DATABASE_URL at its own migrated local Postgres
// (the `batuda` container), so there is nothing to build here. `CI` reaches this
// file via turbo `passThroughEnv` (turbo.json → test:integration).

const IT_URL = integrationDbUrl()

// The `pnpm cli` calls below migrate + seed the integration DB, and the CLI reads
// its credentials (STORAGE_*, auth secrets, …) from the checkout's `.env`. A linked
// worktree created with a bare `git worktree add` has none — only
// `pnpm cli worktree up` writes one — so the seed would die with a ConfigError
// and the pre-push hook couldn't run there at all. Read those values from the
// MAIN checkout's `.env` files (the same source `worktree up` copies from) so
// the setup works in any worktree, provisioned or not. DATABASE_URL is left out
// on purpose: the integration-DB override wins because the CLI keeps an
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
	// the live shell, then the integration-DB target — later spreads win.
	const itEnv = { ...mainCheckoutEnv(), ...process.env, DATABASE_URL: IT_URL }
	const sh = (cmd: string, env: NodeJS.ProcessEnv = process.env) =>
		execSync(cmd, { stdio: 'inherit', shell: '/bin/bash', env })

	// CREATE DATABASE can't run inside a transaction; ignore "already exists". The
	// locale is spelled out for the same reason the dev databases spell it out: under
	// `C` the suite would pass against a database that reads only a-z, which is the
	// one thing these tests must not do.
	sh(
		`docker exec batuda-db psql -U batuda -d postgres -c "CREATE DATABASE ${resolveIntegrationDbName()} LOCALE 'en_US.utf8' TEMPLATE template0" 2>/dev/null || true`,
	)
	// `db reset` migrates to HEAD AND truncates, so a reused integration DB starts
	// from a clean slate (the seed refuses to run against leftover CRM rows).
	sh('pnpm -w cli db reset', itEnv)
	sh('pnpm -w cli seed --quiet', itEnv) // taller/restaurant fixtures the suites rely on
}
