/**
 * Full-stack boot test. Catches the class of regression that PR #13 hit:
 * a missing `Layer.provide` only manifests at runtime, type-checks pass,
 * server crashes ~60s into prod. PR-A1 dropped the runMain cast so
 * `CurrentOrg` / `HttpClient` shaped leaks fail the build — this test
 * covers everything the type system can't see (DB schema drift, broken
 * env-config shapes, race conditions during layer init).
 *
 * Not wired into the default `pnpm test`. Run it explicitly with
 * `pnpm --filter @batuda/server test:integration`. Requires the local
 * dev fixtures to be running (`pnpm cli services up` brings up Postgres
 * + MinIO + Mailpit).
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PORT = 34_040

const env = {
	NODE_ENV: 'production',
	PORT: String(PORT),
	// Local dev fixtures from `pnpm cli services up` (docker-compose sets
	// POSTGRES_PASSWORD=batuda).
	DATABASE_URL: 'postgres://batuda:batuda@localhost:5433/batuda',
	STORAGE_ENDPOINT: 'http://localhost:9000',
	STORAGE_REGION: 'auto',
	STORAGE_ACCESS_KEY_ID: 'batuda',
	STORAGE_SECRET_ACCESS_KEY: 'batuda-secret',
	STORAGE_BUCKET: 'batuda-assets',
	// Boot-time tags must be set; the actual auth flow isn't exercised.
	BETTER_AUTH_SECRET: '00000000000000000000000000000000',
	BETTER_AUTH_BASE_URL: `http://localhost:${PORT}`,
	// APP_PUBLIC_URL is required and validated ∈ ALLOWED_ORIGINS at boot, so
	// these must be a consistent pair (was ALLOWED_ORIGINS='').
	ALLOWED_ORIGINS: `http://localhost:${PORT}`,
	APP_PUBLIC_URL: `http://localhost:${PORT}`,
	EMAIL_CREDENTIAL_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
	EMAIL_PROVIDER: 'local-inbox',
	EMAIL_PROVIDER_TRANSACTIONAL: 'local',
	CALENDAR_PROVIDER: 'stub',
	GEOCODER_PROVIDER: 'nominatim',
	// Research: every provider stubbed so no external network is needed.
	RESEARCH_PROVIDER_SEARCH: 'stub',
	RESEARCH_PROVIDER_SCRAPE: 'stub',
	RESEARCH_PROVIDER_EXTRACT: 'stub',
	RESEARCH_PROVIDER_DISCOVER: 'stub',
	RESEARCH_PROVIDER_REGISTRY_ES: 'stub',
	RESEARCH_PROVIDER_REPORT_ES: 'none',
	RESEARCH_LLM_AGENT_PROVIDERS: 'stub',
	RESEARCH_LLM_EXTRACT_PROVIDERS: 'stub',
	RESEARCH_LLM_WRITER_PROVIDERS: 'stub',
	RESEARCH_DEFAULT_BUDGET_CENTS: '100',
	RESEARCH_DEFAULT_PAID_BUDGET_CENTS: '500',
	RESEARCH_DEFAULT_AUTO_APPROVE_PAID_CENTS: '200',
	RESEARCH_DEFAULT_PAID_MONTHLY_CAP_CENTS: '2000',
	RESEARCH_MONTHLY_CAP_HARD_CEILING_CENTS: '10000',
	RESEARCH_MAX_CONCURRENT_FIBERS_TOTAL: '3',
	RESEARCH_MAX_CONCURRENCY_FANOUT: '3',
	RESEARCH_CONFIRM_THRESHOLD_FANOUT: '10',
} as const

const collectOutput = (proc: ChildProcess) => {
	let stdout = ''
	let stderr = ''
	proc.stdout?.on('data', chunk => {
		stdout += String(chunk)
	})
	proc.stderr?.on('data', chunk => {
		stderr += String(chunk)
	})
	return {
		get stdout() {
			return stdout
		},
		get stderr() {
			return stderr
		},
	}
}

const waitForHealth = async (url: string, timeoutMs: number) => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1_000) })
			if (res.status === 200) return
		} catch {
			// connection refused / timeout — server not ready yet
		}
		await new Promise(r => setTimeout(r, 250))
	}
	throw new Error(`server did not respond on ${url} within ${timeoutMs}ms`)
}

describe('apps/server program boot', () => {
	let proc: ChildProcess
	let output: ReturnType<typeof collectOutput>
	let tmpInbox: string

	beforeAll(async () => {
		// Local-inbox provider writes magic-link emails to disk; isolate
		// per-test-run so we don't dirty the dev inbox.
		tmpInbox = mkdtempSync(join(tmpdir(), 'batuda-boot-test-inbox-'))

		proc = spawn('node', ['dist/main.mjs'], {
			cwd: new URL('..', import.meta.url),
			env: {
				...process.env,
				...env,
				LOCAL_INBOX_DIR: tmpInbox,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		output = collectOutput(proc)

		await waitForHealth(`http://localhost:${PORT}/health`, 20_000)
	}, 30_000)

	afterAll(() => {
		if (proc && !proc.killed) {
			proc.kill('SIGTERM')
		}
		if (tmpInbox) {
			rmSync(tmpInbox, { recursive: true, force: true })
		}
	})

	it('should respond /health → 200', async () => {
		// GIVEN the program has fully booted
		// WHEN we hit /health via the same path KraftCloud uses in its
		// verify step
		const res = await fetch(`http://localhost:${PORT}/health`)
		// THEN it returns 200
		expect(res.status).toBe(200)
	})

	it('should not surface a missing-service Defect during boot', () => {
		// GIVEN the program reached the listening state
		// WHEN we inspect the merged stderr+stdout
		const combined = `${output.stdout}\n${output.stderr}`
		// THEN no Effect runtime "Service not found" should have fired
		// (the failure mode PR #13 fixed — FetchHttpClient missing from the
		//  program's R was only caught at runtime by a brave-search call)
		expect(combined).not.toMatch(/Service not found:/)
	})

	it('should not surface a CurrentOrg out-of-request-scope Defect', () => {
		// GIVEN the CurrentOrgFallbackLive layer dies if read outside a
		// request scope (added in PR #16 alongside the runMain cast drop)
		// WHEN we inspect the buffered output
		const combined = `${output.stdout}\n${output.stderr}`
		// THEN no fallback message should have fired during boot
		expect(combined).not.toMatch(/CurrentOrg accessed outside a request scope/)
	})
})
