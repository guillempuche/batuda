import { Config, Console, Data, Effect } from 'effect'

import {
	inviteAdmin,
	type MagicLinkCallback,
	type MagicLinkCallbackInput,
} from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'
import { isLocalDatabase } from '../lib/database-host'
import { reachableSignInLink } from '../lib/dev-sign-in-link'

export interface AuthInviteAdminInput {
	readonly email: string
	readonly name: string
	readonly orgName: string
	readonly orgSlug: string
	readonly allowExistingOrg: boolean
	readonly locale: string | undefined
	readonly confirmHost: string | undefined
}

export class MagicLinkNotCaptured extends Data.TaggedError(
	'MagicLinkNotCaptured',
)<{
	readonly email: string
}> {}

/**
 * `pnpm cli auth invite-admin` — create-or-find the org, create-or-find the
 * person, and attach them as an admin. They are a member immediately; there is
 * nothing for them to accept.
 *
 * Against a database on this machine it runs Better Auth in-process with a
 * capturing sender and prints the sign-in link, because the developer is
 * standing right there and will open it now. Against any other database it
 * prints where to sign in instead: a link minted here would sit in a mailbox
 * being a working way into the account until someone happened to read it.
 */
export const authInviteAdmin = (input: AuthInviteAdminInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth invite-admin', input.confirmHost)

		// Only a database on this machine means this command can hand the link over
		// itself; a deployment has a running server that sends it, so a link issued
		// here would reach nobody.
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

		const { users, organizations, members, magicLink } =
			yield* acquireAuthAdapter({
				baseURL,
				magicLinkSender: sender,
			})

		const result = yield* inviteAdmin(
			users,
			organizations,
			members,
			magicLink,
			{
				email: input.email,
				name: input.name,
				orgName: input.orgName,
				orgSlug: input.orgSlug,
				allowExistingOrg: input.allowExistingOrg,
				sendMagicLink: canDeliverHere,
				...(input.locale === undefined ? {} : { locale: input.locale }),
			},
		)

		yield* Console.log('')
		yield* Console.log('┌─── Admin invited ──────────────────────────┐')
		yield* Console.log(`│  Email: ${result.user.email.padEnd(34)}│`)
		yield* Console.log(`│  Name:  ${result.user.name.padEnd(34)}│`)
		yield* Console.log(`│  Role:  ${result.assignedRole.padEnd(34)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')
		yield* Console.log('┌─── Organization ───────────────────────────┐')
		yield* Console.log(`│  Slug: ${input.orgSlug.padEnd(35)}│`)
		yield* Console.log(`│  Id:   ${result.organizationId.padEnd(35)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')

		if (!canDeliverHere) {
			yield* Console.log('The admin exists. Nothing was sent from here.')
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
			return result
		}

		const link = captured as MagicLinkCallbackInput | null
		if (link === null) {
			return yield* Effect.fail(
				new MagicLinkNotCaptured({ email: result.user.email }),
			)
		}

		yield* Console.log('Magic link (valid for 5 minutes):')
		yield* Console.log('')
		yield* Console.log(`  ${reachableSignInLink(link.url)}`)
		yield* Console.log('')
		yield* Console.log(
			'Start the server (`pnpm dev:server`) and open the link to complete sign-in.',
		)
		yield* Console.log('')

		return result
	}).pipe(Effect.scoped)
