import { Effect, Option } from 'effect'
import type { SqlClient } from 'effect/sql'

// Runs a step that may fail in a savepoint of its own when a transaction is
// open. A failed statement aborts the transaction around it, so a caller that
// recovers from the failure would still end in a COMMIT that rolls back and
// fails the request. With no transaction open, each statement already stands
// alone and the step runs as it is.
export const inOwnSavepoint =
	(sql: SqlClient.SqlClient) =>
	<A, E, R>(step: Effect.Effect<A, E, R>) =>
		Effect.flatMap(Effect.serviceOption(sql.transactionService), open =>
			Option.isSome(open) ? sql.withTransaction(step) : step,
		)
