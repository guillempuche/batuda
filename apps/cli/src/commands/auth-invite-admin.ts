import { Config, Console, Data, Effect } from 'effect'

import {
	inviteAdmin,
	type MagicLinkCallback,
	type MagicLinkCallbackInput,
} from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'
import { getTarget } from '../lib/load-env'

export interface AuthInviteAdminInput {
	readonly email: string
	readonly name: string
	readonly orgName: string
	readonly orgSlug: string
	readonly allowExistingOrg: boolean
}

export class MagicLinkNotCaptured extends Data.TaggedError(
	'MagicLinkNotCaptured',
)<{
	readonly email: string
}> {}

/**
 * `pnpm cli auth invite-admin` — subsequent invites: create-or-find the
 * org, create-or-find the user, attach as admin, and issue a magic link.
 *
 * Local mode runs Better Auth in-process with a capturing sender so the
 * magic-link URL is printed to stdout for the developer to click. Cloud
 * mode prints a curl recipe pointing at the running server's
 * `/auth/sign-in/magic-link` endpoint, since email delivery is the
 * server's responsibility there.
 */
export const authInviteAdmin = (input: AuthInviteAdminInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth invite-admin')

		const target = getTarget()

		const baseURL = yield* Config.string('BETTER_AUTH_BASE_URL').pipe(
			Config.withDefault('https://api.batuda.localhost'),
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

		if (target === 'cloud') {
			yield* Console.log(
				'(cloud) Magic-link delivery is performed by the running server.',
			)
			yield* Console.log('  Trigger it with:')
			yield* Console.log(
				`    curl -X POST ${baseURL}/auth/sign-in/magic-link \\`,
			)
			yield* Console.log("      -H 'content-type: application/json' \\")
			yield* Console.log(`      -d '{"email":"${result.user.email}"}'`)
			yield* Console.log('')
			return result
		}

		const link = captured as MagicLinkCallbackInput | null
		if (link === null) {
			return yield* Effect.fail(
				new MagicLinkNotCaptured({ email: result.user.email }),
			)
		}

		yield* Console.log('Magic link (valid for a short time):')
		yield* Console.log('')
		yield* Console.log(`  ${link.url}`)
		yield* Console.log('')
		yield* Console.log(
			'Start the server (`pnpm dev:server`) and open the link to complete sign-in.',
		)
		yield* Console.log('')

		return result
	}).pipe(Effect.scoped)
