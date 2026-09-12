import type { Effect } from 'effect'
import type { SqlClient, SqlError } from 'effect/unstable/sql'

// Every operation in this package needs the SQL client and fails only with a
// SQL fault; the app layer redacts the fault before it reaches a caller.
export type Eff<A> = Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>

// A unique index refusing a second row raises a SqlError whose reason is
// tagged, which is what turns it into a clean "already there" answer rather
// than a redacted fault.
export const isUniqueViolation = (err: SqlError.SqlError): boolean =>
	err.reason._tag === 'UniqueViolation'
