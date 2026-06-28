import { execSync } from 'node:child_process'

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

export default function setup(): void {
	if (process.env['CI']) return

	const itEnv = { ...process.env, DATABASE_URL: IT_URL }
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
