import { PgClient } from '@effect/sql-pg'
import { Config } from 'effect'

// Mirrors apps/server/src/db/client.ts so column names come back camelCased
// and parameter objects can be written camelCase too, while the contents of a
// JSON column are handed over exactly as stored. The pool itself connects as
// the DATABASE_URL owner; ingest pins each transaction to `app_service`
// (BYPASSRLS) via `SET LOCAL ROLE` and sets `app.current_org_id` for
// audit-trail consistency. See apps/mail-worker/src/ingest.ts.
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
