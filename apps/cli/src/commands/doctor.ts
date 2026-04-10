import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { Effect } from 'effect'
import type { ChildProcessSpawner } from 'effect/unstable/process'
import { SqlClient } from 'effect/unstable/sql'

import { SqlLive } from '../db'
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

const httpCheck = (name: string, port: number, hint: string): Check => ({
	name,
	run: Effect.tryPromise({
		try: () =>
			fetch(`http://localhost:${port}`, {
				signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
			}),
		catch: () => null,
	}).pipe(
		Effect.map(res => (res ? ok(`listening on :${port}`) : warn(hint))),
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

const allChecks: Check[] = [
	fileCheck('.env', '.env file'),
	fileCheck('apps/cli/.env', 'apps/cli/.env file'),
	dockerCheck,
	composeCheck,
	dbConnectionCheck,
	migrationCheck,
	storageCheck,
	httpCheck('Server', 3000, 'not running → run `pnpm dev:server`'),
]

export const doctor = Effect.gen(function* () {
	const results: CheckResult[] = []
	for (const check of allChecks) {
		const result = yield* check.run
		results.push({ name: check.name, ...result })
	}
	return results
})
