import { Effect } from 'effect'

import type {
	AlreadyMember,
	AuthConfigError,
	MagicLinkFailed,
	UserAlreadyExists,
} from '../domain/errors'
import { OrgSlugTaken } from '../domain/errors'
import type { AuthUser } from '../domain/types'
import type {
	MagicLinkSender,
	MemberRepository,
	OrganizationRepository,
	UserRepository,
} from './ports'

export interface InviteAdminInput {
	readonly email: string
	readonly name: string
	readonly orgName: string
	readonly orgSlug: string
	// When true, an existing org slug is reused and the user joins as
	// admin. When false (default), an existing slug aborts with
	// `OrgSlugTaken` so a typo doesn't bolt the new admin onto someone
	// else's org.
	readonly allowExistingOrg?: boolean
}

export interface InviteAdminResult {
	readonly user: AuthUser
	readonly organizationId: string
	readonly magicLinkSent: boolean
	// 'owner' when this call created the org (Better Auth's creatorRole),
	// 'admin' when joining a pre-existing org under `allowExistingOrg`.
	readonly assignedRole: 'owner' | 'admin'
}

/**
 * Create or reuse an organization, create or find the user, attach them as
 * an admin (or owner, when the org is brand new), and issue a magic link.
 *
 * Idempotent on user creation only — slug reuse without `allowExistingOrg`
 * is the explicit guard against accidentally piggy-backing on someone
 * else's org. The magic link is delivered via whatever transport the
 * caller wired into `magicLink.send` (dev catcher in local, Resend in
 * cloud); the use case never inspects the URL itself.
 */
export const inviteAdmin = (
	users: UserRepository,
	organizations: OrganizationRepository,
	members: MemberRepository,
	magicLink: MagicLinkSender,
	input: InviteAdminInput,
): Effect.Effect<
	InviteAdminResult,
	| OrgSlugTaken
	| AlreadyMember
	| UserAlreadyExists
	| MagicLinkFailed
	| AuthConfigError
> =>
	Effect.gen(function* () {
		const existingOrg = yield* organizations.findBySlug(input.orgSlug)
		if (existingOrg && !input.allowExistingOrg) {
			return yield* Effect.fail(new OrgSlugTaken({ slug: input.orgSlug }))
		}

		// Reuse an existing user when the email matches; the orchestration
		// stays idempotent so re-running with the same inputs is safe.
		const existingUser = yield* users.findByEmail(input.email)
		const user =
			existingUser ??
			(yield* users.createPasswordless({
				email: input.email,
				name: input.name,
				role: 'admin', // Platform-level role; org membership role is separate.
			}))

		// New org → creator becomes 'owner' atomically via Better Auth's
		// creatorRole. Existing org → join explicitly as 'admin'. The
		// asymmetry is intentional: the first member of an org always owns
		// it, subsequent invites are admins by default.
		let organizationId: string
		let assignedRole: 'owner' | 'admin'
		if (existingOrg) {
			organizationId = existingOrg.id
			yield* members.add(
				{
					userId: user.id,
					organizationId: existingOrg.id,
					role: 'admin',
				},
				{ slug: input.orgSlug, email: input.email },
			)
			assignedRole = 'admin'
		} else {
			const created = yield* organizations.create({
				name: input.orgName,
				slug: input.orgSlug,
				creatorUserId: user.id,
				creatorRole: 'owner',
			})
			organizationId = created.id
			assignedRole = 'owner'
		}

		yield* magicLink.send(input.email)

		return {
			user,
			organizationId,
			magicLinkSent: true,
			assignedRole,
		}
	})
