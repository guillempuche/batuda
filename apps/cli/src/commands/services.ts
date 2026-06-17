import { resolve } from 'node:path'

import { Config, Console, Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { PgLive } from '../db'
import { exec, ROOT } from '../shell'
import { isLinkedWorktree } from './worktree'

const COMPOSE_FILE = resolve(ROOT, 'docker/docker-compose.yml')

const compose = (...args: string[]) =>
	exec('docker', 'compose', '-p', 'batuda', '-f', COMPOSE_FILE, ...args).pipe(
		Effect.catch(() =>
			Effect.fail(
				new Error('Docker command failed. Is Docker/OrbStack running?'),
			),
		),
	)

/**
 * After `docker compose up -d`, the DB container needs a moment to
 * accept connections. Retry up to 4 times (1 s apart) then give up
 * silently — the user can always run `pnpm cli doctor` separately.
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

/**
 * GreenMail boots a JVM, so its listeners come up a few seconds after the
 * container starts. Poll the REST readiness endpoint (which answers 503 until
 * ready) up to 15 times, 1 s apart, so `services up` only returns once the
 * catcher can accept mail; give up silently like checkMigrations.
 */
const checkMailCatcher = Effect.gen(function* () {
	const url = yield* Config.string('MAIL_CATCHER_HTTP_URL')
	const probe = Effect.gen(function* () {
		const res = yield* Effect.tryPromise(() =>
			fetch(`${url}/api/service/readiness`, {
				signal: AbortSignal.timeout(2000),
			}),
		)
		if (!res.ok) {
			return yield* Effect.fail(new Error('mail catcher not ready'))
		}
	})
	yield* probe.pipe(
		Effect.retry(Schedule.spaced('1 second').pipe(Schedule.take(15))),
	)
}).pipe(Effect.catchCause(() => Effect.void))

const printServiceUrls = Console.log(
	[
		'',
		'Service URLs:',
		'  Postgres:        postgresql://batuda:batuda@localhost:5433/batuda',
		'  MinIO console:   http://localhost:9001  (batuda / batuda-secret)',
		'  Mail catcher:    http://localhost:8025  (GreenMail REST API)',
	].join('\n'),
)

export const servicesUp = compose('up', '-d').pipe(
	Effect.andThen(checkMigrations),
	Effect.andThen(checkMailCatcher),
	Effect.andThen(printServiceUrls),
)

// Stopping the one shared stack disrupts every worktree and the main checkout, so
// refuse from inside a linked worktree unless explicitly forced — point at the
// per-worktree teardown instead.
export const servicesDown = (force: boolean) =>
	Effect.gen(function* () {
		if (!force && (yield* isLinkedWorktree)) {
			return yield* Effect.fail(
				new Error(
					'`services down` stops the shared stack used by every worktree. Run it from the main checkout, use `pnpm cli worktree down` to remove just this worktree, or pass --force.',
				),
			)
		}
		yield* compose('down')
	})

export const servicesStatus = compose('ps').pipe(
	Effect.andThen(printServiceUrls),
)
