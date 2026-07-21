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
	// Defaults to true. Set false when the caller has no way to deliver the
	// link: issuing one creates a working way into the account, so an
	// undeliverable link is a credential left lying around.
	readonly sendMagicLink?: boolean
	// The language this person reads, when the caller knows it. Left unset, the
	// account carries no preference.
	readonly locale?: string
}

/**
 * Create a user without a password and, unless told otherwise, issue a magic
 * link. The user clicks the link, lands in an authenticated session, and
 * optionally sets a password via the admin UI afterwards.
 *
 * The link goes to whatever transport the caller wired into `magicLink.send`,
 * and this use case never inspects the URL itself.
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
			...(input.locale === undefined ? {} : { locale: input.locale }),
		})
		if (input.sendMagicLink ?? true) yield* magicLink.send(input.email)
		return user
	})
