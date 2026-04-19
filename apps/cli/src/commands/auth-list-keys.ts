import { Console, Effect } from 'effect'

import { listApiKeys } from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { printTable } from '../lib/table'

export interface AuthListKeysInput {
	readonly email: string | undefined
}

/**
 * `pnpm cli auth list-keys [--email]` — show every API key, optionally
 * scoped to a single user. The plaintext key is not displayed (Better-Auth
 * hashes it on write); we surface id / name / prefix / enabled / expires.
 */
export const authListKeys = (input: AuthListKeysInput) =>
	Effect.gen(function* () {
		const { keys } = yield* acquireAuthAdapter()

		const rows = yield* listApiKeys(keys, input.email)

		if (rows.length === 0) {
			yield* Console.log('')
			yield* Console.log(
				input.email
					? `No API keys for ${input.email}.`
					: 'No API keys in this database.',
			)
			yield* Console.log('')
			return rows
		}

		yield* Console.log('')
		yield* printTable(
			[
				{ header: 'KeyId', width: 38, value: k => k.id },
				{ header: 'Name', width: 20, value: k => k.name ?? '' },
				{ header: 'Prefix', width: 12, value: k => k.prefix ?? '' },
				{ header: 'Enabled', width: 10, value: k => String(k.enabled) },
				{
					header: 'Expires',
					width: 0,
					value: k => (k.expiresAt ? k.expiresAt.toISOString() : '—'),
				},
			],
			rows,
		)
		yield* Console.log('')
		yield* Console.log(`  ${rows.length} key(s)`)
		yield* Console.log('')
		return rows
	}).pipe(Effect.scoped)
