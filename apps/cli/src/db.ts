import { PgClient } from '@effect/sql-pg'
import { Config, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

const DB_MISSING_MSG =
	'DATABASE_URL is not set.\n' +
	'  1. Run `pnpm cli setup` to create .env files\n' +
	'  2. Set DATABASE_URL in apps/cli/.env\n' +
	'  See .env.example for the expected format.'

const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

const camelToSnake = (s: string) =>
	s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)

export const PgLive = PgClient.layerConfig({
	url: Config.redacted('DATABASE_URL'),
	transformResultNames: Config.succeed(snakeToCamel),
	transformQueryNames: Config.succeed(camelToSnake),
})

/**
 * Wraps PgLive so a missing DATABASE_URL config surfaces a helpful
 * setup message instead of an opaque ConfigError.
 */
export const SqlLive = PgLive.pipe(
	Layer.catch(e =>
		(e as { _tag?: string })._tag === 'ConfigError'
			? Layer.effect(SqlClient.SqlClient, Effect.die(new Error(DB_MISSING_MSG)))
			: Layer.effect(SqlClient.SqlClient, Effect.die(e)),
	),
)

/**
 * Provide SqlLive to an effect that requires SqlClient.
 * Only builds the DB layer when the wrapped effect actually runs,
 * so commands that don't call withDb never need DATABASE_URL.
 */
export const withDb = <A, E, R>(
	effect: Effect.Effect<A, E, SqlClient.SqlClient | R>,
): Effect.Effect<A, E, Exclude<R, SqlClient.SqlClient>> =>
	Effect.provide(effect, SqlLive)

export { SqlClient }
