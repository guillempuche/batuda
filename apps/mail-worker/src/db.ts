import { PgClient } from '@effect/sql-pg'
import { Config } from 'effect'

// Mirrors apps/server/src/db/client.ts so SELECTs come back camelCased
// and parameter objects can be written camelCase too. The worker
// connects as `app_service` (BYPASSRLS); RLS scoping is achieved with
// per-transaction `SET LOCAL app.current_org_id`.
export const PgLive = PgClient.layerConfig({
	url: Config.redacted('DATABASE_URL'),
	transformResultNames: Config.succeed((s: string) =>
		s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
	),
	transformQueryNames: Config.succeed((s: string) =>
		s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`),
	),
})
