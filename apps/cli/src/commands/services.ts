import { resolve } from 'node:path'

import { Console, Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { PgLive } from '../db'
import { exec, ROOT } from '../shell'

const COMPOSE_FILE = resolve(ROOT, 'docker/docker-compose.yml')

const compose = (...args: string[]) =>
	exec('docker', 'compose', '-f', COMPOSE_FILE, ...args).pipe(
		Effect.catch(() =>
			Effect.fail(
				new Error('Docker command failed. Is Docker/OrbStack running?'),
			),
		),
	)

/**
 * After `docker compose up -d`, the DB container needs a moment to
 * accept connections. Retry up to 4 times (1 s apart) then give up
 * silently -- the user can always run `pnpm cli doctor` separately.
 */
const checkMigrations = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const result =
		yield* sql`SELECT COUNT(*)::int as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
	const tableCount = (result[0] as { count: number } | undefined)?.count ?? 0
	if (tableCount === 0) {
		yield* Console.log(
			'\nNo tables found. Run `pnpm cli db migrate` to set up the schema.',
		)
	}
}).pipe(
	Effect.provide(Layer.fresh(PgLive)),
	Effect.retry(Schedule.spaced('1 second').pipe(Schedule.take(4))),
	Effect.catchCause(() => Effect.void),
)

const printServiceUrls = Console.log(
	[
		'',
		'Service URLs:',
		'  Postgres:        postgresql://batuda:batuda@localhost:5433/batuda',
		'  MinIO console:   http://localhost:9001  (batuda / batuda-secret)',
		'  mailpit web UI:  http://localhost:8025',
	].join('\n'),
)

export const servicesUp = compose('up', '-d').pipe(
	Effect.andThen(checkMigrations),
	Effect.andThen(printServiceUrls),
)

export const servicesDown = compose('down')

export const servicesStatus = compose('ps').pipe(
	Effect.andThen(printServiceUrls),
)
