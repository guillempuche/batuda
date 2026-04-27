import { apiKey as apiKeyPlugin } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { hashPassword } from 'better-auth/crypto'
import {
	admin,
	bearer,
	magicLink as magicLinkPlugin,
	openAPI,
	organization,
} from 'better-auth/plugins'
import { Effect } from 'effect'
import type pg from 'pg'

import type {
	AddMemberInput,
	ApiKeyRepository,
	CreateApiKeyInput,
	CreatedApiKey,
	MagicLinkSender,
	MemberRepository,
	NewOrganizationInput,
	NewUserInput,
	NewUserWithPasswordInput,
	OrganizationRepository,
	SessionRepository,
	UserRepository,
} from '../application/ports'
import {
	AlreadyMember,
	ApiKeyNotFound,
	AuthConfigError,
	MagicLinkFailed,
	OrgSlugTaken,
	UserAlreadyExists,
	UserNotFound,
} from '../domain/errors'
import type {
	ApiKeyRecord,
	AuthUser,
	Organization,
	Role,
	SessionRecord,
} from '../domain/types'
import type { AuthEnv } from './build-better-auth-config'
import { buildBetterAuthConfig } from './build-better-auth-config'

export interface MagicLinkCallbackInput {
	readonly email: string
	readonly url: string
	readonly token: string
}
export type MagicLinkCallback = (input: MagicLinkCallbackInput) => Promise<void>

// Rows as returned by the Kysely-backed `"user"` table that Better-Auth manages.
// We hit pg directly for read-only queries because the admin plugin's list /
// get endpoints require an active session, and the CLI runs without one.
interface UserRow {
	id: string
	email: string
	name: string
	role: string | null
	emailVerified: boolean
	createdAt: Date
}

interface ApiKeyRow {
	id: string
	name: string | null
	prefix: string | null
	userId: string
	enabled: boolean
	expiresAt: Date | null
	createdAt: Date
}

interface SessionRow {
	id: string
	userId: string
	userEmail: string
	expiresAt: Date
	createdAt: Date
	ipAddress: string | null
	userAgent: string | null
}

interface OrganizationRow {
	id: string
	name: string
	slug: string
	createdAt: Date
}

const toOrganization = (row: OrganizationRow): Organization => ({
	id: row.id,
	name: row.name,
	slug: row.slug,
	createdAt: row.createdAt,
})

const toUser = (row: UserRow): AuthUser => ({
	id: row.id,
	email: row.email,
	name: row.name,
	role: row.role === 'admin' || row.role === 'user' ? row.role : null,
	emailVerified: row.emailVerified,
	createdAt: row.createdAt,
})

const toApiKey = (row: ApiKeyRow): ApiKeyRecord => ({
	id: row.id,
	name: row.name,
	prefix: row.prefix,
	userId: row.userId,
	enabled: row.enabled,
	expiresAt: row.expiresAt,
	createdAt: row.createdAt,
})

const toSession = (row: SessionRow): SessionRecord => ({
	id: row.id,
	userId: row.userId,
	userEmail: row.userEmail,
	expiresAt: row.expiresAt,
	createdAt: row.createdAt,
	ipAddress: row.ipAddress,
	userAgent: row.userAgent,
})

const queryError = (cause: unknown): AuthConfigError =>
	new AuthConfigError({
		message: cause instanceof Error ? cause.message : String(cause),
	})

// Better-Auth's admin `createUser` surfaces duplicate-email as a generic
// APIError. We pattern-match the message so the use case sees a meaningful
// `UserAlreadyExists` instead of an opaque `AuthConfigError`.
const mapCreateUserError = (
	email: string,
	cause: unknown,
): UserAlreadyExists | AuthConfigError => {
	const message = cause instanceof Error ? cause.message : String(cause)
	if (/already exists|duplicate|UNIQUE/i.test(message)) {
		return new UserAlreadyExists({ email })
	}
	return new AuthConfigError({ message })
}

export interface BetterAuthAdapterInput {
	readonly env: AuthEnv
	readonly pool: pg.Pool
	/**
	 * Invoked by Better-Auth's magic-link plugin whenever a link is issued.
	 * Omit this field when the caller does not need magic-link delivery — the
	 * `magicLink` port returned by the adapter will then fail loudly if
	 * someone actually calls `send`, while still carrying a real plugin so
	 * the instance's API types stay stable across callers.
	 */
	readonly magicLinkSender?: MagicLinkCallback
}

/**
 * Build the adapter-backed repositories (users / keys / sessions /
 * organizations / members / magicLink) on top of a CLI-flavored
 * `betterAuth()` instance. The instance carries the same plugin set as the
 * server so API keys and sessions created here validate against the
 * running server at runtime.
 */
export const makeBetterAuthAdapter = (
	input: BetterAuthAdapterInput,
): {
	readonly users: UserRepository
	readonly keys: ApiKeyRepository
	readonly sessions: SessionRepository
	readonly organizations: OrganizationRepository
	readonly members: MemberRepository
	readonly magicLink: MagicLinkSender
} => {
	// The plugin is always wired so `instance.api.signInMagicLink` is part of
	// the inferred type regardless of whether the caller actually needs magic
	// links. When `magicLinkSender` is omitted, the callback is a no-op; the
	// `magicLink` port itself gates on the original `input.magicLinkSender`
	// value and refuses to fire to avoid silently swallowing tokens.
	const noopSender: MagicLinkCallback = async () => {}
	const resolvedSender = input.magicLinkSender ?? noopSender

	const instance = betterAuth(
		buildBetterAuthConfig({
			env: input.env,
			pool: input.pool,
			plugins: [
				openAPI(),
				bearer(),
				admin(),
				// CLI mirrors the server's plugin set so adapter-issued sessions
				// and API keys carry the same plugin shape as runtime requests.
				organization(),
				apiKeyPlugin({ enableSessionForAPIKeys: true }),
				magicLinkPlugin({
					sendMagicLink: data =>
						resolvedSender({
							email: data.email,
							url: data.url,
							token: data.token,
						}),
				}),
			],
		}),
	)

	const { pool } = input

	const users: UserRepository = {
		countAll: Effect.tryPromise({
			try: () =>
				pool.query<{ count: string }>(
					'SELECT count(*)::text AS count FROM "user"',
				),
			catch: queryError,
		}).pipe(Effect.map(r => Number(r.rows[0]?.count ?? '0'))),

		findByEmail: email =>
			Effect.tryPromise({
				try: () =>
					pool.query<UserRow>(
						'SELECT id, email, name, role, "emailVerified", "createdAt" FROM "user" WHERE email = $1 LIMIT 1',
						[email],
					),
				catch: queryError,
			}).pipe(Effect.map(r => (r.rows[0] ? toUser(r.rows[0]) : null))),

		listAll: Effect.tryPromise({
			try: () =>
				pool.query<UserRow>(
					'SELECT id, email, name, role, "emailVerified", "createdAt" FROM "user" ORDER BY "createdAt" ASC',
				),
			catch: queryError,
		}).pipe(Effect.map(r => r.rows.map(toUser))),

		createWithPassword: (input: NewUserWithPasswordInput) =>
			Effect.tryPromise({
				try: () =>
					instance.api.createUser({
						body: {
							email: input.email,
							password: input.password,
							name: input.name,
							role: input.role,
						},
					}),
				catch: cause => mapCreateUserError(input.email, cause),
			}).pipe(
				Effect.flatMap(() =>
					Effect.tryPromise({
						try: () =>
							pool.query<UserRow>(
								'SELECT id, email, name, role, "emailVerified", "createdAt" FROM "user" WHERE email = $1 LIMIT 1',
								[input.email],
							),
						catch: queryError,
					}),
				),
				Effect.flatMap(r =>
					r.rows[0]
						? Effect.succeed(toUser(r.rows[0]))
						: Effect.fail(
								new AuthConfigError({
									message: `createUser succeeded but lookup for ${input.email} failed`,
								}),
							),
				),
			),

		createPasswordless: (input: NewUserInput) => {
			const throwaway = `bootstrap-${Math.random().toString(36).slice(2)}-${Date.now()}`
			return Effect.tryPromise({
				try: () =>
					instance.api.createUser({
						body: {
							email: input.email,
							password: throwaway,
							name: input.name,
							role: input.role,
						},
					}),
				catch: cause => mapCreateUserError(input.email, cause),
			}).pipe(
				Effect.flatMap(() =>
					Effect.tryPromise({
						try: () =>
							pool.query<UserRow>(
								'SELECT id, email, name, role, "emailVerified", "createdAt" FROM "user" WHERE email = $1 LIMIT 1',
								[input.email],
							),
						catch: queryError,
					}),
				),
				Effect.flatMap(lookup => {
					const row = lookup.rows[0]
					if (!row) {
						return Effect.fail(
							new AuthConfigError({
								message: `createUser succeeded but lookup for ${input.email} failed`,
							}),
						)
					}
					return Effect.tryPromise({
						try: () =>
							pool.query(
								'DELETE FROM "account" WHERE "userId" = $1 AND "providerId" = $2',
								[row.id, 'credential'],
							),
						catch: queryError,
					}).pipe(Effect.map(() => toUser(row)))
				}),
			)
		},

		setRole: (email: string, role: Role) =>
			Effect.tryPromise({
				try: () =>
					pool.query<{ id: string }>(
						'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
						[email],
					),
				catch: queryError,
			}).pipe(
				Effect.flatMap(
					(lookup): Effect.Effect<void, UserNotFound | AuthConfigError> =>
						lookup.rows[0]
							? Effect.tryPromise({
									try: () =>
										pool.query(
											'UPDATE "user" SET role = $1, "updatedAt" = now() WHERE id = $2',
											[role, lookup.rows[0]!.id],
										),
									catch: queryError,
								}).pipe(Effect.asVoid)
							: Effect.fail(new UserNotFound({ email })),
				),
			),

		setPassword: (email: string, password: string) =>
			Effect.tryPromise({
				try: () =>
					pool.query<{ id: string }>(
						'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
						[email],
					),
				catch: queryError,
			}).pipe(
				Effect.flatMap(
					(lookup): Effect.Effect<void, UserNotFound | AuthConfigError> => {
						const row = lookup.rows[0]
						if (!row) return Effect.fail(new UserNotFound({ email }))
						return Effect.tryPromise({
							try: () => hashPassword(password),
							catch: queryError,
						}).pipe(
							Effect.flatMap(hashed =>
								Effect.tryPromise({
									try: async () => {
										const client = await pool.connect()
										try {
											await client.query('BEGIN')
											const update = await client.query(
												`UPDATE "account" SET password = $2, "updatedAt" = now()
											 WHERE "userId" = $1 AND "providerId" = 'credential'`,
												[row.id, hashed],
											)
											if (update.rowCount === 0) {
												await client.query(
													`INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
												 VALUES (gen_random_uuid()::text, $1, 'credential', $1, $2, now(), now())`,
													[row.id, hashed],
												)
											}
											await client.query('COMMIT')
										} catch (e) {
											await client.query('ROLLBACK').catch(() => {})
											throw e
										} finally {
											client.release()
										}
									},
									catch: queryError,
								}),
							),
						)
					},
				),
				Effect.asVoid,
			),
	}

	// `@better-auth/api-key` v1.5+ stores the owner foreign key in the column
	// `"referenceId"`, not `"userId"`. The body input to `createApiKey` still
	// accepts `userId` (the plugin maps it internally), so we only need the
	// alias on the raw `SELECT`s — the `ApiKeyRecord` domain type keeps the
	// field name `userId` for callers.
	const keys: ApiKeyRepository = {
		list: email =>
			Effect.tryPromise({
				try: () =>
					email
						? pool.query<ApiKeyRow>(
								`SELECT k.id, k.name, k.prefix, k."referenceId" AS "userId", k.enabled, k."expiresAt", k."createdAt"
								 FROM apikey k
								 JOIN "user" u ON u.id = k."referenceId"
								 WHERE u.email = $1
								 ORDER BY k."createdAt" DESC`,
								[email],
							)
						: pool.query<ApiKeyRow>(
								`SELECT id, name, prefix, "referenceId" AS "userId", enabled, "expiresAt", "createdAt"
								 FROM apikey
								 ORDER BY "createdAt" DESC`,
							),
				catch: queryError,
			}).pipe(Effect.map(r => r.rows.map(toApiKey))),

		create: (input: CreateApiKeyInput) =>
			Effect.tryPromise({
				try: () =>
					pool.query<{ id: string; role: string | null }>(
						'SELECT id, role FROM "user" WHERE email = $1 LIMIT 1',
						[input.email],
					),
				catch: queryError,
			}).pipe(
				Effect.flatMap(
					(
						lookup,
					): Effect.Effect<CreatedApiKey, UserNotFound | AuthConfigError> => {
						const owner = lookup.rows[0]
						if (!owner)
							return Effect.fail(new UserNotFound({ email: input.email }))
						return Effect.tryPromise({
							try: () =>
								instance.api.createApiKey({
									body: {
										userId: owner.id,
										name: input.name,
										prefix: input.prefix,
										...(input.expiresIn !== undefined
											? { expiresIn: input.expiresIn }
											: {}),
									},
								}),
							catch: queryError,
						}).pipe(
							Effect.map(result => {
								const ownerRole: Role | 'user' =
									owner.role === 'admin' ? 'admin' : 'user'
								return {
									id: result.id,
									key: result.key,
									ownerEmail: input.email,
									ownerRole,
									name: input.name,
								} satisfies CreatedApiKey
							}),
						)
					},
				),
			),

		revoke: keyId =>
			Effect.tryPromise({
				try: () =>
					pool.query(
						'UPDATE apikey SET enabled = false, "updatedAt" = now() WHERE id = $1',
						[keyId],
					),
				catch: queryError,
			}).pipe(
				Effect.flatMap(result =>
					result.rowCount === 0
						? Effect.fail(new ApiKeyNotFound({ keyId }))
						: Effect.void,
				),
			),
	}

	const sessions: SessionRepository = {
		list: email =>
			Effect.tryPromise({
				try: () =>
					email
						? pool.query<SessionRow>(
								`SELECT s.id, s."userId", u.email AS "userEmail", s."expiresAt", s."createdAt", s."ipAddress", s."userAgent"
								 FROM "session" s
								 JOIN "user" u ON u.id = s."userId"
								 WHERE u.email = $1
								 ORDER BY s."createdAt" DESC`,
								[email],
							)
						: pool.query<SessionRow>(
								`SELECT s.id, s."userId", u.email AS "userEmail", s."expiresAt", s."createdAt", s."ipAddress", s."userAgent"
								 FROM "session" s
								 JOIN "user" u ON u.id = s."userId"
								 ORDER BY s."createdAt" DESC`,
							),
				catch: queryError,
			}).pipe(Effect.map(r => r.rows.map(toSession))),
	}

	const organizations: OrganizationRepository = {
		findBySlug: slug =>
			Effect.tryPromise({
				try: () =>
					pool.query<OrganizationRow>(
						'SELECT id, name, slug, "createdAt" FROM "organization" WHERE slug = $1 LIMIT 1',
						[slug],
					),
				catch: queryError,
			}).pipe(Effect.map(r => (r.rows[0] ? toOrganization(r.rows[0]) : null))),

		create: (createInput: NewOrganizationInput) =>
			Effect.tryPromise({
				try: () =>
					instance.api.createOrganization({
						body: {
							name: createInput.name,
							slug: createInput.slug,
							// Better Auth requires either an authenticated session or
							// `userId` on the body to attach the creator as the first
							// member; CLI runs without a session so we always pass it.
							userId: createInput.creatorUserId,
						},
					}),
				catch: cause => {
					const message = cause instanceof Error ? cause.message : String(cause)
					if (/ORGANIZATION_ALREADY_EXISTS|already exists/i.test(message)) {
						return new OrgSlugTaken({ slug: createInput.slug })
					}
					return new AuthConfigError({ message })
				},
			}).pipe(
				Effect.flatMap(result => {
					if (!result?.id) {
						return Effect.fail(
							new AuthConfigError({
								message: `createOrganization returned no id for slug=${createInput.slug}`,
							}),
						)
					}
					return Effect.succeed({
						id: result.id,
						name: result.name,
						slug: result.slug,
						createdAt:
							result.createdAt instanceof Date
								? result.createdAt
								: new Date(result.createdAt),
					} satisfies Organization)
				}),
			),
	}

	const members: MemberRepository = {
		add: (addInput: AddMemberInput, context) =>
			Effect.tryPromise({
				try: () =>
					instance.api.addMember({
						body: {
							userId: addInput.userId,
							organizationId: addInput.organizationId,
							role: addInput.role,
						},
					}),
				catch: cause => {
					const message = cause instanceof Error ? cause.message : String(cause)
					if (/USER_IS_ALREADY_A_MEMBER|already a member/i.test(message)) {
						return new AlreadyMember({
							email: context.email,
							slug: context.slug,
						})
					}
					return new AuthConfigError({ message })
				},
			}).pipe(Effect.asVoid),
	}

	const magicLink: MagicLinkSender = {
		send: email =>
			input.magicLinkSender === undefined
				? Effect.fail(
						new MagicLinkFailed({
							email,
							cause: 'MagicLinkSender not configured on adapter',
						}),
					)
				: Effect.tryPromise({
						try: () =>
							instance.api.signInMagicLink({
								body: { email },
								headers: {},
							}),
						catch: cause =>
							new MagicLinkFailed({
								email,
								cause: cause instanceof Error ? cause.message : String(cause),
							}),
					}).pipe(Effect.asVoid),
	}

	return { users, keys, sessions, organizations, members, magicLink }
}
