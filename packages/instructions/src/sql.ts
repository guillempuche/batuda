import { Effect } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

// Every operation in this package needs the SQL client and fails only with a
// SQL fault; the app layer redacts the fault before it reaches a caller.
export type Eff<A> = Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>

// A unique index refusing a second row raises a SqlError whose reason is
// tagged, which is what turns it into a clean "already there" answer rather
// than a redacted fault.
export const isUniqueViolation = (err: SqlError.SqlError): boolean =>
	err.reason._tag === 'UniqueViolation'

// Runs a write that a unique index may refuse in a savepoint of its own (a
// transaction of its own when none is open). A refused statement aborts the
// transaction around it, so without this the caller's "already there" answer
// would end in a COMMIT that rolls back.
export const inSavepoint = <A>(write: Eff<A>): Eff<A> =>
	Effect.flatMap(SqlClient.SqlClient, sql => sql.withTransaction(write))
