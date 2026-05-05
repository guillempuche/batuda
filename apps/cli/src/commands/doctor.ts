import { existsSync } from 'node:fs'
import { request } from 'node:https'
import { resolve } from 'node:path'

import { Effect } from 'effect'
import type { ChildProcessSpawner } from 'effect/unstable/process'
import { SqlClient } from 'effect/unstable/sql'

import { SqlLive } from '../db'
import { getTarget } from '../lib/load-env'
import { execSilent, ROOT } from '../shell'

export type Status = 'ok' | 'warn' | 'fail'

export interface CheckResult {
	name: string
	status: Status
	detail: string
}

interface Check {
	name: string
	run: Effect.Effect<
		Omit<CheckResult, 'name'>,
		unknown,
		ChildProcessSpawner.ChildProcessSpawner
	>
}

const ok = (detail: string) => ({ status: 'ok' as const, detail })
const warn = (detail: string) => ({ status: 'warn' as const, detail })
const fail = (detail: string) => ({ status: 'fail' as const, detail })

const fileCheck = (rel: string, label: string): Check => ({
	name: label,
	run: Effect.succeed(
		existsSync(resolve(ROOT, rel))
			? ok('found')
			: fail('missing → run `pnpm cli setup`'),
	),
})

const dockerCheck: Check = {
	name: 'Docker',
	run: execSilent('docker', 'info').pipe(
		Effect.map(() => ok('running')),
		Effect.catch(() =>
			Effect.succeed(fail('not running → start Docker Desktop or OrbStack')),
		),
	),
}

const composeCheck: Check = {
	name: 'DB container',
	run: execSilent(
		'docker',
		'compose',
		'-f',
		resolve(ROOT, 'docker/docker-compose.yml'),
		'ps',
		'--status',
		'running',
		'-q',
	).pipe(
		Effect.map(out =>
			out.length > 0
				? ok('running')
				: warn('stopped → run `pnpm cli services up`'),
		),
		Effect.catch(() =>
			Effect.succeed(
				warn('stopped → start Docker, then `pnpm cli services up`'),
			),
		),
	),
}

const dbConnectionCheck: Check = {
	name: 'DB connection',
	run: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`SELECT 1`
		return ok('connected')
	}).pipe(
		Effect.provide(SqlLive),
		Effect.catchCause(() =>
			Effect.succeed(
				fail(
					'unreachable → check DATABASE_URL in apps/cli/.env and DB container',
				),
			),
		),
	),
}

const migrationCheck: Check = {
	name: 'Migrations',
	run: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const result =
			yield* sql`SELECT COUNT(*)::int as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
		const count = (result[0] as { count: number } | undefined)?.count ?? 0
		return count > 0
			? ok(`${count} tables`)
			: warn('no tables → run `pnpm cli db migrate`')
	}).pipe(
		Effect.provide(SqlLive),
		Effect.catchCause(() =>
			Effect.succeed(fail('query failed → fix DB connection first')),
		),
	),
}

const HTTP_TIMEOUT_MS = 2_000

// Probes the public portless URL (not the internal node port) so the
// check passes iff `portless` is also running and routing traffic — that
// is the URL docs tell operators to hit. Uses node:https directly with
// `rejectUnauthorized: false` because dev environments use self-signed
// certs for `*.localhost` — same pragmatism as `curl -k`.
const probe = (url: string): Promise<number | null> =>
	new Promise(resolvePromise => {
		const req = request(
			url,
			{ method: 'GET', rejectUnauthorized: false },
			res => {
				resolvePromise(res.statusCode ?? null)
				res.resume()
			},
		)
		req.on('error', () => resolvePromise(null))
		req.setTimeout(HTTP_TIMEOUT_MS, () => {
			req.destroy()
			resolvePromise(null)
		})
		req.end()
	})

const urlCheck = (name: string, url: string, hint: string): Check => ({
	name,
	run: Effect.tryPromise({
		try: () => probe(url),
		catch: () => null,
	}).pipe(
		Effect.map(status =>
			status !== null && status < 400
				? ok(url)
				: status !== null
					? warn(`${url} → ${status}`)
					: warn(hint),
		),
		Effect.catch(() => Effect.succeed(warn(hint))),
	),
})

const storageCheck: Check = {
	name: 'Storage (MinIO)',
	run: Effect.tryPromise({
		try: () =>
			fetch('http://localhost:9000/minio/health/live', {
				signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
			}),
		catch: () => null,
	}).pipe(
		Effect.map(res =>
			res?.ok
				? ok('listening on :9000')
				: warn('stopped → run `pnpm cli services up`'),
		),
		Effect.catch(() =>
			Effect.succeed(warn('stopped → run `pnpm cli services up`')),
		),
	),
}

const emailCredentialKeyCheck: Check = {
	name: 'EMAIL_CREDENTIAL_KEY',
	run: Effect.sync(() => {
		const value = process.env['EMAIL_CREDENTIAL_KEY'] ?? ''
		if (!value) {
			return fail('not set → required for inbox seed; run `pnpm cli setup`')
		}
		const decoded = Buffer.from(value, 'base64')
		if (decoded.length !== 32) {
			return fail(
				`base64 must decode to 32 bytes (got ${decoded.length}) → regenerate with \`node -e "console.log(crypto.randomBytes(32).toString('base64'))"\``,
			)
		}
		return ok('32 bytes')
	}),
}

const mailpitCheck: Check = {
	name: 'Mailpit',
	run: Effect.tryPromise({
		try: () =>
			fetch('http://localhost:8025/api/v1/info', {
				signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
			}),
		catch: () => null,
	}).pipe(
		Effect.map(res =>
			res?.ok
				? ok(
						'listening on :8025 (SMTP :1025; no IMAP — seed uses direct INSERT)',
					)
				: warn('stopped → run `pnpm cli services up`'),
		),
		Effect.catch(() =>
			Effect.succeed(warn('stopped → run `pnpm cli services up`')),
		),
	),
}

// Process check for the mail-worker. The worker is a long-running
// Node process supervised by `turbo dev` (not Docker), so no port
// to probe. Both server and mail-worker dev scripts share argv
// (`node --watch --import tsx src/main.ts`); the only distinguisher
// is cwd. Pipe pgrep through lsof to keep just the apps/mail-worker
// children. Cloud-tier doctor skips this; in prod the worker runs
// under its own deploy.
const MAIL_WORKER_PROCESS_CHECK = `
for pid in $(pgrep -f 'tsx src/main.ts' 2>/dev/null); do
  cwd=$(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd"{print $NF; exit}')
  case "$cwd" in *apps/mail-worker*) echo "$pid $cwd";; esac
done
`

const mailWorkerCheck: Check = {
	name: 'mail-worker',
	run: execSilent('sh', '-c', MAIL_WORKER_PROCESS_CHECK).pipe(
		Effect.map(out => {
			const lines = out
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean)
			if (lines.length === 0) {
				return warn(
					'not running → start `pnpm dev` (or `pnpm dev:mail-worker`)',
				)
			}
			const pids = lines.map(l => l.split(/\s+/, 1)[0]).join(',')
			if (lines.length === 1) return ok(`running (PID ${pids})`)
			return warn(
				`${lines.length} instances running (PIDs ${pids}) — competing on inbox claims; kill duplicates with \`kill ${pids.replace(/,/g, ' ')}\``,
			)
		}),
		Effect.catch(() =>
			Effect.succeed(
				warn('process scan failed; cannot determine mail-worker status'),
			),
		),
	),
}

const cloudDbHostCheck: Check = {
	name: 'Cloud DB host',
	run: Effect.sync(() => {
		const url = process.env['DATABASE_URL'] ?? ''
		if (!url) return fail('DATABASE_URL missing')
		try {
			const host = new URL(url).hostname
			if (host === 'localhost' || host === '127.0.0.1') {
				return fail(`points to ${host} — local value in cloud env file?`)
			}
			return ok(host)
		} catch {
			return fail('DATABASE_URL is not a valid URL')
		}
	}),
}

const cloudAuthUrlCheck: Check = {
	name: 'BETTER_AUTH_BASE_URL',
	run: Effect.sync(() => {
		const url = process.env['BETTER_AUTH_BASE_URL'] ?? ''
		if (!url) return fail('not set — required for cloud')
		if (!url.startsWith('https://')) {
			return fail(`must be https:// (got ${url})`)
		}
		return ok(url)
	}),
}

const localChecks: Check[] = [
	fileCheck('.env', '.env file'),
	fileCheck('apps/cli/.env', 'apps/cli/.env file'),
	emailCredentialKeyCheck,
	dockerCheck,
	composeCheck,
	dbConnectionCheck,
	migrationCheck,
	storageCheck,
	mailpitCheck,
	urlCheck(
		'Server',
		'https://api.batuda.localhost/health',
		'not running → run `pnpm dev:server`',
	),
	mailWorkerCheck,
]

const cloudChecks: Check[] = [
	fileCheck('.env.cloud', '.env.cloud file'),
	cloudDbHostCheck,
	cloudAuthUrlCheck,
	dbConnectionCheck,
	migrationCheck,
]

export const doctor = Effect.gen(function* () {
	const target = getTarget()
	const targetResult: CheckResult = {
		name: 'Target',
		status: 'ok',
		detail: target === 'cloud' ? 'CLOUD ⚠' : 'local',
	}
	const checks = target === 'cloud' ? cloudChecks : localChecks
	const results: CheckResult[] = [targetResult]
	for (const check of checks) {
		const result = yield* check.run
		results.push({ name: check.name, ...result })
	}
	return results
})
