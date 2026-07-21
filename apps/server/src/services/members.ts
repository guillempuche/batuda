import { Context, Effect, Layer } from 'effect'

import { BadRequest, Conflict, Forbidden } from '@batuda/controllers'
import type { LangCode } from '@batuda/domain'

import { Auth } from '../lib/auth'
import { EnvVars } from '../lib/env'
import { TransactionalEmailProvider } from './transactional-email-provider'
import { TransactionalEmailProviderLive } from './transactional-email-provider-live'

export interface AddedMember {
	readonly id: string
	readonly userId: string
	readonly email: string
	readonly name: string | null
	readonly role: string
	readonly locale: string
	readonly createdAt: string
}

export interface AddMemberInput {
	readonly email: string
	readonly role: 'member' | 'admin'
	readonly locale: LangCode
}

// Who may add someone to an organization. Better Auth's own add-member call
// checks nothing — it is unreachable over HTTP and assumes the caller has
// already decided — so this set is the entire gate on this path.
const MANAGING_ROLES: ReadonlySet<string> = new Set(['owner', 'admin'])

interface UserRow {
	readonly id: string
	readonly name: string | null
	readonly locale: string | null
}

interface MemberRow {
	readonly id: string
	readonly role: string
	readonly createdAt: Date | string
}

// Adding someone creates their account and their membership in one go, then
// tells them by email — a message that carries no way in, since they sign in
// themselves and ask for their own short-lived link. Every read and write goes
// through Better Auth's owner pool, the same as API-key management, because
// the auth tables sit outside the request's app_user scope.
export class MemberService extends Context.Service<MemberService>()(
	'MemberService',
	{
		make: Effect.gen(function* () {
			const auth = yield* Auth
			const env = yield* EnvVars
			const transactional = yield* TransactionalEmailProvider

			const findUser = (email: string) =>
				Effect.tryPromise(() =>
					auth.pool.query<UserRow>(
						'SELECT id, name, locale FROM "user" WHERE lower(email) = lower($1) LIMIT 1',
						[email],
					),
				).pipe(
					Effect.orDie,
					Effect.map(result => result.rows[0] ?? null),
				)

			const findMember = (orgId: string, userId: string) =>
				Effect.tryPromise(() =>
					auth.pool.query<MemberRow>(
						'SELECT id, role, "createdAt" FROM member WHERE "organizationId" = $1 AND "userId" = $2 LIMIT 1',
						[orgId, userId],
					),
				).pipe(
					Effect.orDie,
					Effect.map(result => result.rows[0] ?? null),
				)

			// How to refer to someone in a message to another person. The email is
			// the fallback because an account can exist before anyone has typed a
			// name for it.
			const findDisplayIdentity = (userId: string) =>
				Effect.tryPromise(() =>
					auth.pool.query<{ name: string | null; email: string }>(
						'SELECT name, email FROM "user" WHERE id = $1 LIMIT 1',
						[userId],
					),
				).pipe(
					Effect.orDie,
					Effect.map(result => result.rows[0] ?? null),
				)

			const findOrgName = (orgId: string) =>
				Effect.tryPromise(() =>
					auth.pool.query<{ name: string }>(
						'SELECT name FROM organization WHERE id = $1 LIMIT 1',
						[orgId],
					),
				).pipe(
					Effect.orDie,
					Effect.map(result => result.rows[0]?.name ?? null),
				)

			// Better Auth reports failures as an error carrying a stable code;
			// matching on the code rather than the message keeps this working if
			// the wording ever changes.
			const errorCode = (cause: unknown): string | null => {
				if (typeof cause !== 'object' || cause === null) return null
				const body = (cause as { body?: unknown }).body
				if (typeof body !== 'object' || body === null) return null
				const code = (body as { code?: unknown }).code
				return typeof code === 'string' ? code : null
			}

			// Postgres' unique-violation code. Two people adding the same address
			// at the same moment both get past Better Auth's "does this account
			// exist" check, and whichever loses the insert surfaces this instead
			// of a coded error. It means the same thing: the account is there now.
			const isDuplicateRow = (cause: unknown): boolean =>
				typeof cause === 'object' &&
				cause !== null &&
				(cause as { code?: unknown }).code === '23505'

			// Better Auth's way of saying the account already exists.
			const ACCOUNT_EXISTS: ReadonlySet<string> = new Set([
				'USER_ALREADY_EXISTS',
				'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
			])

			return {
				add: (
					orgId: string,
					actorUserId: string,
					input: AddMemberInput,
				): Effect.Effect<AddedMember, Forbidden | Conflict | BadRequest> =>
					Effect.gen(function* () {
						const actor = yield* findMember(orgId, actorUserId)
						if (!actor || !MANAGING_ROLES.has(actor.role)) {
							return yield* new Forbidden({
								message: 'Only an owner or an admin can add members.',
							})
						}

						const existingUser = yield* findUser(input.email)
						if (existingUser === null) {
							// No headers on purpose: that makes the admin endpoint skip
							// its own permission check, which the role check above has
							// already made. Passing the caller's headers would fail
							// outright — they are an admin of this organization, not of
							// the whole install. Fields under `data` land on the
							// account's own columns.
							yield* Effect.tryPromise({
								try: () =>
									auth.instance.api.createUser({
										body: {
											email: input.email,
											name: input.email.split('@')[0] ?? input.email,
											data: { locale: input.locale },
										},
									}),
								catch: cause => cause,
							}).pipe(
								Effect.catch(cause => {
									const code = errorCode(cause)
									// The account already exists — either it did before, or a
									// concurrent add just created it. Either way the re-read
									// below settles which row we are working with.
									if (
										(code !== null && ACCOUNT_EXISTS.has(code)) ||
										isDuplicateRow(cause)
									) {
										return Effect.void
									}
									// Better Auth rejected the address itself, which is the
									// caller's mistake and worth telling them about.
									if (code === 'INVALID_EMAIL') {
										return Effect.fail(
											new BadRequest({
												message: 'That email address cannot be used.',
											}),
										)
									}
									// Anything else is ours, not theirs — a database outage
									// must not be reported back as a bad address.
									return Effect.die(cause)
								}),
							)
						} else if (existingUser.locale === null) {
							// Someone already using Batuda keeps the language they picked;
							// this only fills in a blank. The `IS NULL` is repeated in the
							// write because a concurrent add could have set one since the
							// read, and overwriting a real choice is worse than skipping.
							yield* Effect.tryPromise(() =>
								auth.pool.query(
									'UPDATE "user" SET locale = $1 WHERE id = $2 AND locale IS NULL',
									[input.locale, existingUser.id],
								),
							).pipe(Effect.orDie)
						}

						const user = yield* findUser(input.email)
						if (user === null) {
							return yield* Effect.die(
								new Error(`account missing after create for ${input.email}`),
							)
						}

						// Creating the account and granting the membership are two
						// separate writes owned by Better Auth, so they cannot share a
						// transaction. If the second fails on an account we made moments
						// ago, remove it: an account with no memberships can still request
						// a sign-in link and land in an app with nothing in it. An account
						// that existed beforehand is left alone — it is not ours to delete.
						const accountIsNew = existingUser === null
						const undoAccount = accountIsNew
							? Effect.tryPromise(() =>
									auth.pool.query('DELETE FROM "user" WHERE id = $1', [
										user.id,
									]),
								).pipe(Effect.orDie, Effect.asVoid)
							: Effect.void

						yield* Effect.tryPromise({
							try: () =>
								auth.instance.api.addMember({
									body: {
										userId: user.id,
										role: input.role,
										organizationId: orgId,
									},
								}),
							catch: cause => cause,
						}).pipe(
							Effect.catch(cause => {
								const code = errorCode(cause)
								if (code === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION') {
									return undoAccount.pipe(
										Effect.andThen(
											Effect.fail(
												new Conflict({
													message:
														'That person is already in this organization.',
												}),
											),
										),
									)
								}
								// Better Auth caps membership at 100 by default and we do not
								// raise it. Without this the hundred-and-first add is a 500
								// with no explanation instead of something an admin can act
								// on.
								if (code === 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED') {
									return undoAccount.pipe(
										Effect.andThen(
											Effect.fail(
												new Conflict({
													message:
														'This organization has reached its limit on members.',
												}),
											),
										),
									)
								}
								return undoAccount.pipe(Effect.andThen(Effect.die(cause)))
							}),
						)

						const member = yield* findMember(orgId, user.id)
						if (member === null) {
							return yield* Effect.die(
								new Error(`membership missing after add for ${input.email}`),
							)
						}

						const [orgName, addedBy] = yield* Effect.all([
							findOrgName(orgId),
							findDisplayIdentity(actorUserId),
						])

						// The membership is already written, so a mail failure must not
						// fail the request — retrying would only report "already a
						// member". Log it instead: the person can still sign in, they
						// just were not told yet.
						yield* transactional
							.sendMemberAdded({
								email: input.email,
								addedByName: addedBy?.name ?? addedBy?.email ?? 'A teammate',
								organizationName: orgName ?? 'your organization',
								signInUrl: `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/login`,
								locale: user.locale ?? input.locale,
							})
							.pipe(
								Effect.catch(cause =>
									Effect.logError('member added but welcome email failed').pipe(
										Effect.annotateLogs({
											event: 'member.welcome_email_failed',
											orgId,
											memberId: member.id,
											cause: String(cause),
										}),
									),
								),
							)

						return {
							id: member.id,
							userId: user.id,
							email: input.email,
							name: user.name,
							role: member.role,
							locale: user.locale ?? input.locale,
							createdAt:
								member.createdAt instanceof Date
									? member.createdAt.toISOString()
									: String(member.createdAt),
						}
					}),
			}
		}),
	},
) {
	// Provides its own mail transport, the same way `Auth` does — the layer that
	// picks between real delivery and the local folder is chosen by env, and
	// nothing upstream of this service needs to know which one won.
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(TransactionalEmailProviderLive),
	)
}
