import { Effect, type Scope } from 'effect'
import pg from 'pg'

/**
 * Scoped `pg.Pool` that the caller can drop into an `Effect.scoped` block.
 * Release always runs (even on interrupt) so CLI commands never leak a pool
 * when they bail out on a prompt or an unexpected error.
 */
export const acquirePgPool = (
	connectionString: string,
): Effect.Effect<pg.Pool, never, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.sync(() => new pg.Pool({ connectionString })),
		pool => Effect.promise(() => pool.end()),
	)
