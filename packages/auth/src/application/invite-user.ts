import { Effect } from 'effect'

import type {
	AuthConfigError,
	MagicLinkFailed,
	UserAlreadyExists,
} from '../domain/errors'
import type { AuthUser, Role } from '../domain/types'
import type { MagicLinkSender, UserRepository } from './ports'

export interface InviteUserInput {
	readonly email: string
	readonly name: string
	readonly role: Role
}

/**
 * Create a user without a password and immediately issue a magic link. The
 * user clicks the link, lands in an authenticated session, and optionally
 * sets a password via the admin UI afterwards.
 *
 * Locally the magic link is written to `apps/server/.dev-inbox/`; in cloud it
 * goes through AgentMail. The CLI layer is responsible for surfacing (or
 * *not* surfacing, in cloud) the resulting URL.
 */
export const inviteUser = (
	users: UserRepository,
	magicLink: MagicLinkSender,
	input: InviteUserInput,
): Effect.Effect<
	AuthUser,
	UserAlreadyExists | AuthConfigError | MagicLinkFailed
> =>
	Effect.gen(function* () {
		const user = yield* users.createPasswordless({
			email: input.email,
			name: input.name,
			role: input.role,
		})
		yield* magicLink.send(input.email)
		return user
	})
