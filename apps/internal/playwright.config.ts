import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))

// One `git` invocation, or null when git can't answer (a tarball checkout).
// Run from this file's directory so it resolves the checkout the tests live in,
// not wherever the process happened to start.
const git = (...args: string[]): string | null => {
	try {
		return execFileSync('git', args, {
			cwd: CONFIG_DIR,
			encoding: 'utf8',
		}).trim()
	} catch {
		return null
	}
}

// The checkout root — a linked worktree's own root, or the main repo. Its `.env`
// (written by `pnpm cli worktree up`) names this checkout's own database and mail
// catcher, and the branch here drives the host portless serves it on.
const CHECKOUT_ROOT =
	git('rev-parse', '--show-toplevel') ?? resolve(CONFIG_DIR, '../..')

// Playwright never loads `.env`, so a fixture that seeds through `psql` falls
// back to the MAIN checkout's database — writing rows the browser, pointed at
// THIS checkout's app, never sees. Copy the connection vars the suite reads out
// of the checkout's own `.env` into the environment its workers inherit, unless
// already set (an explicit export or CI still wins). Only these keys are copied;
// the rest of `.env` holds secrets the suite has no use for.
for (const key of [
	'DATABASE_URL',
	'MAIL_CATCHER_HTTP_URL',
	'MAIL_CATCHER_SMTP_HOST',
	'MAIL_CATCHER_SMTP_PORT',
]) {
	if (process.env[key] !== undefined) continue
	const envPath = join(CHECKOUT_ROOT, '.env')
	if (!existsSync(envPath)) break
	const value = readFileSync(envPath, 'utf8')
		.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]
		?.trim()
	if (value) process.env[key] = value
}

// Golden-path E2E suite. Hits the running dev stack — this checkout's own
// origin, resolved below — so the browser exercises real Better-Auth cookies,
// real RLS-gated reads, real local-inbox writes, none of which a unit test can
// prove together. From a linked worktree it targets that worktree's app and
// database automatically; no env exports needed.
//
// Prerequisites for `pnpm test:e2e`:
//   1. `pnpm cli services up`    — Postgres + MinIO containers
//   2. `pnpm cli db reset`        — fresh migrations
//   3. `pnpm cli seed`            — DEMO_* personas + sample CRM
//   4. `pnpm dev`                 — server + internal stack for this checkout
//   5. `pnpm exec playwright install chromium` (one-time per machine)
//
// The suite intentionally targets only flows whose components carry
// `data-testid` attributes today (login + compose). Add another test
// when the next flow's testids land — don't pre-write tests for
// selectors that don't exist yet.

// portless can't bind 443 without root, so it falls back to a non-privileged
// port and records it in ~/.portless/proxy.port — read that so `pnpm test:e2e`
// hits the same origin the browser does, with no manual export. Fall back to the
// bare host (portless on its 443 default, or no portless) when the file is absent.
const portlessPortSuffix = (() => {
	try {
		const port = readFileSync(
			join(homedir(), '.portless', 'proxy.port'),
			'utf8',
		).trim()
		return port && port !== '443' ? `:${port}` : ''
	} catch {
		return ''
	}
})()

// portless serves the main checkout on the bare `batuda.localhost` and each
// linked worktree on its own `<label>.batuda.localhost`, where the label is the
// branch's last path segment as a DNS label. Mirror that derivation (kept in step
// with apps/cli/src/commands/worktree.ts) so a run inside a worktree targets its
// own app, not main's — otherwise the browser and the psql fixtures land on
// different checkouts. A linked worktree is one whose root differs from the repo
// that owns the shared `.git` directory.
const MAX_DNS_LABEL = 63
const dnsLabel = (raw: string): string => {
	const sane = raw
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '')
	if (sane.length <= MAX_DNS_LABEL) return sane
	const hash = createHash('sha256').update(sane).digest('hex').slice(0, 6)
	return `${sane.slice(0, MAX_DNS_LABEL - 7).replace(/-+$/, '')}-${hash}`
}
const isLinkedWorktree = (() => {
	const commonDir = git('rev-parse', '--git-common-dir')
	if (!commonDir) return false
	return (
		resolve(dirname(resolve(CONFIG_DIR, commonDir))) !== resolve(CHECKOUT_ROOT)
	)
})()
const worktreeHost = (() => {
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
	if (!isLinkedWorktree || !branch) return 'batuda.localhost'
	return `${dnsLabel(branch.split('/').pop() ?? branch)}.batuda.localhost`
})()

// E2E_BASE_URL wins (CI / staging / an explicit port); otherwise the worktree's
// own origin on the portless port.
const BASE_URL =
	process.env['E2E_BASE_URL'] ?? `https://${worktreeHost}${portlessPortSuffix}`

// Specs that build their own request context — signing in as a second person,
// calling the API directly — cannot read this constant, so they fall back to
// `E2E_BASE_URL`. Publishing it here means that fallback resolves to the origin
// the browser is actually using, instead of the main checkout's address, which
// nothing answers on in a worktree or on CI.
process.env['E2E_BASE_URL'] = BASE_URL

const STORAGE_STATE = 'tests/e2e/.auth/alice.json'

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	// Sequential — the dev stack is shared state; per-test isolation comes
	// from `pnpm cli db reset && pnpm cli seed` between manual runs, not from parallelism.
	fullyParallel: false,
	workers: 1,
	// One retry in CI so a single transient blip (a slow mount, a network
	// hiccup) doesn't fail a PR on the smoke gate; a test that only passes on
	// retry still surfaces in the report and gets triaged (docs/runbooks.md).
	// Zero locally so a flake is loud instead of silently absorbed.
	retries: process.env['CI'] ? 1 : 0,
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
		// project. Includes the magic-link sign-in variant.
		{
			name: 'unauth',
			testMatch: /(?:sign-in(?:-magic-link)?|forgot-password)\.test\.ts/,
			use: { ...devices['Desktop Chrome'] },
		},
		// 3. Everything else gets Alice's cookie injected via
		// storageState, so we don't pay the sign-in cost per test.
		{
			name: 'authed',
			testMatch: /.*\.test\.ts/,
			testIgnore: /(?:sign-in(?:-magic-link)?|forgot-password)\.test\.ts/,
			use: {
				...devices['Desktop Chrome'],
				storageState: STORAGE_STATE,
			},
			dependencies: ['setup'],
		},
	],
})
