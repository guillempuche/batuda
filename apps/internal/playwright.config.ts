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
// `data-testid` attributes today (login + compose). Add another test
// when the next flow's testids land — don't pre-write tests for
// selectors that don't exist yet.

// Default targets the portless dev URL on :443 (its documented default).
// Override with E2E_BASE_URL when running against a non-default port,
// staging, or CI.
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'https://batuda.localhost'

const STORAGE_STATE = 'tests/e2e/.auth/alice.json'

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
		// 1. Run the auth.setup test first — it signs in once and writes
		// storageState to a fixture file. Without this, every authenticated
		// test would call POST /auth/sign-in/email and trip Better Auth's
		// per-endpoint rate limit.
		{
			name: 'setup',
			testMatch: /.*\.setup\.ts/,
			use: { ...devices['Desktop Chrome'] },
		},
		// 2. Tests for the sign-in flow itself need a fresh,
		// unauthenticated context. They run independently of the setup
		// project.
		{
			name: 'unauth',
			testMatch: /sign-in\.test\.ts/,
			use: { ...devices['Desktop Chrome'] },
		},
		// 3. Everything else gets Alice's cookie injected via
		// storageState, so we don't pay the sign-in cost per test.
		{
			name: 'authed',
			testMatch: /.*\.test\.ts/,
			testIgnore: /sign-in\.test\.ts/,
			use: {
				...devices['Desktop Chrome'],
				storageState: STORAGE_STATE,
			},
			dependencies: ['setup'],
		},
	],
})
