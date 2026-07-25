import { PgClient } from '@effect/sql-pg'
import { Config } from 'effect'

// Column names are converted between the database's `snake_case` and the
// `camelCase` the app writes. `transformJson: false` keeps that conversion out
// of the contents of a JSON column, so a JSON value is stored and read back with
// exactly the keys the app wrote — and a list whose first entry is empty reads
// back at all, instead of failing the query.
export const PgLive = PgClient.layerConfig({
	url: Config.redacted('DATABASE_URL'),
	transformResultNames: Config.succeed((s: string) =>
		s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
	),
	transformQueryNames: Config.succeed((s: string) =>
		s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`),
	),
	transformJson: Config.succeed(false),
})
