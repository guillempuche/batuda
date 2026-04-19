import { Console, Effect } from 'effect'

import { listUsers } from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { printTable } from '../lib/table'

/**
 * `pnpm cli auth list-users` — dump every row in `"user"` in creation order.
 *
 * Read-only, so no cloud gate. Empty DBs print a helpful pointer to
 * `auth bootstrap` instead of a silent no-op.
 */
export const authListUsers = Effect.gen(function* () {
	const { users } = yield* acquireAuthAdapter()

	const rows = yield* listUsers(users)

	if (rows.length === 0) {
		yield* Console.log('')
		yield* Console.log('No users yet. Create one with:')
		yield* Console.log('  pnpm cli auth bootstrap')
		yield* Console.log('')
		return rows
	}

	yield* Console.log('')
	yield* printTable(
		[
			{ header: 'Email', width: 38, value: u => u.email },
			{ header: 'Name', width: 24, value: u => u.name },
			{ header: 'Role', width: 8, value: u => u.role ?? 'user' },
			{ header: 'Created', width: 0, value: u => u.createdAt.toISOString() },
		],
		rows,
	)
	yield* Console.log('')
	yield* Console.log(`  ${rows.length} user(s)`)
	yield* Console.log('')
	return rows
}).pipe(Effect.scoped)
