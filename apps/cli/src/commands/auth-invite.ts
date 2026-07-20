import { Config, Console, Data, Effect } from 'effect'

import {
	inviteUser,
	type MagicLinkCallback,
	type MagicLinkCallbackInput,
	type Role,
} from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'
import { isLocalDatabase } from '../lib/database-host'

export interface AuthInviteInput {
	readonly email: string
	readonly name: string
	readonly role: Role
	readonly confirmHost: string | undefined
}

export class MagicLinkNotCaptured extends Data.TaggedError(
	'MagicLinkNotCaptured',
)<{
	readonly email: string
}> {}

/**
 * `pnpm cli auth invite` — create a passwordless user and issue a magic link.
 *
 * When the database is on this machine, the link is generated in-process by a
 * capturing sender and printed to stdout, for the person to open in a browser
 * while the server runs. Against any other database the command creates the
 * account only and prints the request that makes the running server send the
 * link, since email leaves from the server rather than from here.
 */
export const authInvite = (input: AuthInviteInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth invite', input.confirmHost)

		// Whether this run can show the link itself, decided by the database it
		// reached rather than by a flag someone may have left off.
		const canDeliverHere = isLocalDatabase()

		const baseURL = yield* Config.string('BETTER_AUTH_BASE_URL').pipe(
			Config.withDefault('https://api.batuda.localhost'),
		)

		let captured: MagicLinkCallbackInput | null = null
		const sender: MagicLinkCallback = async data => {
			captured = data
		}

		const { users, magicLink } = yield* acquireAuthAdapter({
			baseURL,
			magicLinkSender: sender,
		})

		const user = yield* inviteUser(users, magicLink, {
			...input,
			sendMagicLink: canDeliverHere,
		})

		yield* Console.log('')
		yield* Console.log('┌─── User invited ───────────────────────────┐')
		yield* Console.log(`│  Email: ${user.email.padEnd(34)}│`)
		yield* Console.log(`│  Name:  ${user.name.padEnd(34)}│`)
		yield* Console.log(`│  Role:  ${(user.role ?? 'user').padEnd(34)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')

		if (!canDeliverHere) {
			yield* Console.log(
				'Magic-link delivery is performed by the running server.',
			)
			yield* Console.log('  Trigger it with:')
			yield* Console.log(
				`    curl -X POST ${baseURL}/auth/sign-in/magic-link \\`,
			)
			yield* Console.log("      -H 'content-type: application/json' \\")
			yield* Console.log(`      -d '{"email":"${user.email}"}'`)
			yield* Console.log('')
			return user
		}

		const link = captured as MagicLinkCallbackInput | null
		if (link === null) {
			return yield* Effect.fail(new MagicLinkNotCaptured({ email: user.email }))
		}

		yield* Console.log('Magic link (valid for a short time):')
		yield* Console.log('')
		yield* Console.log(`  ${link.url}`)
		yield* Console.log('')
		yield* Console.log(
			'Start the server (`pnpm dev:server`) and open the link to complete sign-in.',
		)
		yield* Console.log('')

		return user
	}).pipe(Effect.scoped)
