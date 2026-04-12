import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { PostgresDialect } from 'kysely'
import type pg from 'pg'

/**
 * The minimum shape any caller needs to build a Better-Auth config. Plain
 * strings (not `Redacted`) so both the server (which unwraps `EnvVars` via
 * `Redacted.value`) and the CLI (which reads `Config.redacted` and unwraps
 * the same way) can pass it in without pulling Effect into this module.
 */
export interface AuthEnv {
	readonly secret: string
	readonly baseURL: string | undefined
	readonly useSecureCookies: boolean
	readonly trustedOrigins: ReadonlyArray<string>
}

export interface BuildBetterAuthConfigInput<
	Plugins extends BetterAuthPlugin[],
> {
	readonly env: AuthEnv
	readonly pool: pg.Pool
	readonly plugins: Plugins
}

/**
 * Single source of truth for the Engranatge Better-Auth config. Both
 * `apps/server/src/lib/auth.ts` (which serves `/auth/*`) and CLI commands
 * (which mint users / keys / sessions out-of-band) must agree on every
 * plugin, field, and rate-limit setting — a drift here would break key
 * verification at runtime, since the apiKey plugin hashes configuration
 * into its validation path.
 *
 * Deliberately **not** annotated with an explicit return type: we need
 * TypeScript to infer the narrowest possible shape so that
 * `betterAuth<Options extends BetterAuthOptions>(...)` picks up both the
 * concrete plugin tuple (so `auth.api.createUser` / `createApiKey` exist)
 * *and* the literal `additionalFields` record (so the user type carries
 * `isAgent`). An annotated return type — even the exact `BetterAuthOptions
 * & { plugins: Plugins }` — would widen `additionalFields` to a plain
 * record and lose `isAgent` on the inferred `User`.
 *
 * The `satisfies BetterAuthOptions` assertion at the end is the type-
 * safety belt: the compiler still verifies every field matches the
 * `BetterAuthOptions` contract while keeping the literal inferred shape.
 */
export const buildBetterAuthConfig = <Plugins extends BetterAuthPlugin[]>(
	input: BuildBetterAuthConfigInput<Plugins>,
) =>
	({
		basePath: '/auth' as const,
		...(input.env.baseURL ? { baseURL: input.env.baseURL } : {}),
		secret: input.env.secret,
		database: {
			dialect: new PostgresDialect({ pool: input.pool }),
			type: 'postgres' as const,
		},
		// Sign-up is invite-only: the public `/auth/sign-up/email` endpoint
		// is disabled (Better-Auth returns 400 `Email and password sign up
		// is not enabled`). New users must be created via the admin plugin
		// (`auth.api.createUser`) — see `bootstrapFirstAdmin` / `inviteUser`.
		emailAndPassword: { enabled: true, disableSignUp: true },
		user: {
			additionalFields: {
				isAgent: {
					type: 'boolean' as const,
					required: false,
					defaultValue: false,
				},
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 30, // 30 days
			updateAge: 60 * 60 * 24 * 7, // renew weekly
		},
		plugins: input.plugins,
		rateLimit: {
			enabled: true,
			storage: 'memory' as const,
			window: 60,
			max: 100,
		},
		advanced: {
			cookiePrefix: 'forja',
			useSecureCookies: input.env.useSecureCookies,
		},
		trustedOrigins: [...input.env.trustedOrigins],
	}) satisfies BetterAuthOptions
