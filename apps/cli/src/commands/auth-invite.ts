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
import { reachableSignInLink } from '../lib/dev-sign-in-link'

export interface AuthInviteInput {
	readonly email: string
	readonly name: string
	readonly role: Role
	readonly locale: string | undefined
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
		// Where the person actually signs in — the app, not the API.
		const appUrl = yield* Config.string('APP_PUBLIC_URL').pipe(
			Config.withDefault('https://batuda.localhost'),
		)

		let captured: MagicLinkCallbackInput | null = null
		const sender: MagicLinkCallback = async data => {
			captured = data
		}

		const { users, magicLink } = yield* acquireAuthAdapter({
			baseURL,
			magicLinkSender: sender,
		})

		// `locale` is pulled out of the spread so it is omitted entirely when
		// unset, rather than passed as an explicit `undefined` — the account then
		// keeps a null instead of being pinned to a guess.
		const { locale, ...rest } = input
		const user = yield* inviteUser(users, magicLink, {
			...rest,
			sendMagicLink: canDeliverHere,
			...(locale === undefined ? {} : { locale }),
		})

		yield* Console.log('')
		yield* Console.log('┌─── User invited ───────────────────────────┐')
		yield* Console.log(`│  Email: ${user.email.padEnd(34)}│`)
		yield* Console.log(`│  Name:  ${user.name.padEnd(34)}│`)
		yield* Console.log(`│  Role:  ${(user.role ?? 'user').padEnd(34)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')

		if (!canDeliverHere) {
			yield* Console.log('The account exists. Nothing was sent from here.')
			yield* Console.log('')
			yield* Console.log('  Tell them to sign in at:')
			yield* Console.log(`    ${appUrl}/login`)
			yield* Console.log('')
			yield* Console.log(
				'  They enter this address and get their own link, good for 5',
			)
			yield* Console.log(
				'  minutes from the moment they ask for it. Sending one from here',
			)
			yield* Console.log(
				'  instead would put a working way into the account in a mailbox,',
			)
			yield* Console.log('  waiting for whenever they happened to read it.')
			yield* Console.log('')
			return user
		}

		const link = captured as MagicLinkCallbackInput | null
		if (link === null) {
			return yield* Effect.fail(new MagicLinkNotCaptured({ email: user.email }))
		}

		yield* Console.log('Magic link (valid for 5 minutes):')
		yield* Console.log('')
		yield* Console.log(`  ${reachableSignInLink(link.url)}`)
		yield* Console.log('')
		yield* Console.log(
			'Start the server (`pnpm dev:server`) and open the link to complete sign-in.',
		)
		yield* Console.log('')

		return user
	}).pipe(Effect.scoped)
