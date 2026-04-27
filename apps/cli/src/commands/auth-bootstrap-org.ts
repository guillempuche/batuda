import { Console, Effect } from 'effect'

import { bootstrapFirstAdmin } from '@batuda/auth'

import { acquireAuthAdapter } from '../lib/auth-adapter'
import { confirmCloud } from '../lib/confirm-cloud'

export interface AuthBootstrapOrgInput {
	readonly email: string
	readonly name: string
	readonly password: string
	readonly orgName: string
	readonly orgSlug: string
}

/**
 * `pnpm cli auth bootstrap-org` — first-run combo: create the very first
 * admin user *and* their owning organization.
 *
 * Refuses if any row exists in `"user"` (same gate as `auth bootstrap`).
 * The new user is created with password (platform `role='admin'`); the new
 * org is created via Better Auth's `createOrganization` with `userId` set
 * so the creator is attached as `owner` atomically.
 */
export const authBootstrapOrg = (input: AuthBootstrapOrgInput) =>
	Effect.gen(function* () {
		yield* confirmCloud('auth bootstrap-org')

		const { users, organizations } = yield* acquireAuthAdapter()

		const user = yield* bootstrapFirstAdmin(users, {
			email: input.email,
			name: input.name,
			password: input.password,
		})

		const org = yield* organizations.create({
			name: input.orgName,
			slug: input.orgSlug,
			creatorUserId: user.id,
			creatorRole: 'owner',
		})

		yield* Console.log('')
		yield* Console.log('┌─── Admin created ──────────────────────────┐')
		yield* Console.log(`│  Email: ${user.email.padEnd(34)}│`)
		yield* Console.log(`│  Name:  ${user.name.padEnd(34)}│`)
		yield* Console.log(`│  Role:  ${(user.role ?? 'user').padEnd(34)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')
		yield* Console.log('┌─── Organization created ───────────────────┐')
		yield* Console.log(`│  Name: ${org.name.padEnd(35)}│`)
		yield* Console.log(`│  Slug: ${org.slug.padEnd(35)}│`)
		yield* Console.log(`│  Role: ${'owner'.padEnd(35)}│`)
		yield* Console.log('└────────────────────────────────────────────┘')
		yield* Console.log('')
		yield* Console.log(`  User id: ${user.id}`)
		yield* Console.log(`  Org id:  ${org.id}`)
		yield* Console.log('')
		yield* Console.log('Sign in:')
		yield* Console.log(
			'  curl -X POST https://api.batuda.localhost/auth/sign-in/email \\',
		)
		yield* Console.log("    -H 'content-type: application/json' \\")
		yield* Console.log(
			`    -d '{"email":"${user.email}","password":"<your password>"}'`,
		)
		yield* Console.log('')

		return { user, organization: org }
	}).pipe(Effect.scoped)
