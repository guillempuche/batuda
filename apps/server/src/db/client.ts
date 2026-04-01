import { PgClient } from '@effect/sql-pg'
import { Config } from 'effect'

export const PgLive = PgClient.layerConfig({
	url: Config.redacted('DATABASE_URL'),
	transformResultNames: Config.succeed((s: string) =>
		s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
	),
	transformQueryNames: Config.succeed((s: string) =>
		s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`),
	),
})
