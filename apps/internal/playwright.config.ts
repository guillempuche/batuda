import { defineConfig, devices } from '@playwright/test'

// Golden-path E2E suite. Hits the running dev stack at
// https://batuda.localhost so the browser exercises real Better-Auth
// cookies, real RLS-gated reads, real local-inbox writes — none of which
// a unit test can prove together.
//
// Prerequisites for `pnpm test:e2e`:
//   1. `pnpm cli services up`    — Postgres + MinIO containers
//   2. `pnpm cli db reset`        — fresh migrations + DEMO_* personas
//   3. `pnpm dev`                 — server + internal stack on batuda.localhost
//   4. `pnpm exec playwright install chromium` (one-time per machine)
//
// The suite intentionally targets only flows whose components carry
// `data-testid` attributes today (login + compose). Add another spec when
// the next flow's testids land — don't pre-write specs for selectors that
// don't exist yet.

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://batuda.localhost'

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	// Sequential — the dev stack is shared state; per-test isolation comes
	// from `pnpm cli db reset` between manual runs, not from parallelism.
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: BASE_URL,
		// `batuda.localhost` is portless's self-signed cert in dev.
		ignoreHTTPSErrors: true,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
})
