import { Config, Console, Data, Effect } from 'effect'

import {
	inviteUser,
	type MagicLinkCallback,
	type MagicLinkCallbackInput,
	type Role,
} from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'
import { getTarget } from '../lib/load-env'

export interface AuthInviteInput {
	readonly email: string
	readonly name: string
	readonly role: Role
}

export class MagicLinkNotCaptured extends Data.TaggedError(
	'MagicLinkNotCaptured',
)<{
	readonly email: string
}> {}

/**
 * `pnpm cli auth invite` — create a passwordless user and issue a magic link.
 *
 * Local mode uses an in-process Better-Auth instance with a capturing sender:
 * the generated URL is printed to stdout directly and the user opens it in
 * their browser while the server is running. In cloud the URL is routed
 * through AgentMail by the server process, so this command prints a pointer
 * to the HTTP endpoint instead of dispatching the email itself.
 */
export const authInvite = (input: AuthInviteInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth invite')

		const target = getTarget()

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

		const user = yield* inviteUser(users, magicLink, input)

		yield* Console.log('')
		yield* Console.log('┌─── User invited ───────────────────────────┐')
		yield* Console.log(`│  Email: ${user.email.padEnd(34)}│`)
		yield* Console.log(`│  Name:  ${user.name.padEnd(34)}│`)
		yield* Console.log(`│  Role:  ${(user.role ?? 'user').padEnd(34)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')

		if (target === 'cloud') {
			yield* Console.log(
				'(cloud) Magic-link delivery is performed by the running server via AgentMail.',
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
