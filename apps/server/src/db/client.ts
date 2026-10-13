import { PgClient } from '@effect/sql-pg'
import { Config, Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

// Column names are converted between the database's `snake_case` and the
// `camelCase` the app writes. `transformJson: false` keeps that conversion out
// of the contents of a JSON column, so a JSON value is stored and read back with
// exactly the keys the app wrote — and a list whose first entry is empty reads
// back at all, instead of failing the query.
export const PgLive = PgClient.layerConfig({
	url: Config.Redacted('DATABASE_URL'),
	transformResultNames: Config.succeed((s: string) =>
		s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
	),
	transformQueryNames: Config.succeed((s: string) =>
		s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`),
	),
	transformJson: Config.succeed(false),
	// Named statements cache a query plan, and a migration that adds a column
	// while the old code still serves makes every `SELECT *` plan fail.
	prepare: Config.succeed(false),
	// Written out though it is the driver's default: a tool call waiting on a
	// person's approval holds one of these, so this is the ceiling that wait
	// counts against.
	maxConnections: Config.succeed(10),
}).pipe(
	// The driver connects on first use. One query while starting turns a database
	// it cannot reach into a failed boot, rather than a process that answers its
	// health check and fails every request — which a deploy would put in place
	// of a release that works.
	Layer.tap(context =>
		Context.get(context, SqlClient.SqlClient)`SELECT 1`.pipe(
			// Above the driver's own five-second limit for connecting, so a slow
			// first connection is left to that limit rather than cut short here.
			Effect.timeout('10 seconds'),
			Effect.orDie,
		),
	),
)
