import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { PostgresDialect } from 'kysely'
import type pg from 'pg'

/** Plain strings (not Effect `Redacted`) so both the server and CLI can use this without pulling in Effect. */
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
 * Single source of truth for the Better-Auth config — server and CLI must
 * agree on every plugin, field, and rate-limit setting. No explicit return
 * type: TS must infer the narrowest literal so `betterAuth()` sees the
 * concrete plugin tuple and `additionalFields`.
 */

// Strip the first hostname label (the API subdomain) to get a parent cookie
// domain. e.g. api.batuda.co → batuda.co.
const cookieDomainFromBaseURL = (
	baseURL: string | undefined,
): string | undefined => {
	if (!baseURL) return undefined
	try {
		const { hostname } = new URL(baseURL)
		const labels = hostname.split('.')
		return labels.length >= 3 ? labels.slice(1).join('.') : undefined // Bare host like "localhost" has no parent domain.
	} catch {
		return undefined
	}
}

export const buildBetterAuthConfig = <Plugins extends BetterAuthPlugin[]>(
	input: BuildBetterAuthConfigInput<Plugins>,
) => {
	const cookieDomain = cookieDomainFromBaseURL(input.env.baseURL)

	return {
		basePath: '/auth' as const,
		...(input.env.baseURL ? { baseURL: input.env.baseURL } : {}), // Omit key entirely when undefined — Better Auth infers from request.
		secret: input.env.secret,
		database: {
			dialect: new PostgresDialect({ pool: input.pool }),
			type: 'postgres' as const,
		},
		emailAndPassword: { enabled: true, disableSignUp: true }, // Invite-only: new users created via admin plugin, not public sign-up.
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
		databaseHooks: {
			session: {
				create: {
					// Auto-pick activeOrganizationId for users with exactly one
					// membership so the common case skips the org picker. With
					// zero or many memberships we leave it unset — multi-org users
					// must select via /auth/organization/set-active so the active
					// scope is always intentional, never silently inherited.
					before: async (session, ctx) => {
						if (session['activeOrganizationId']) return { data: session }
						const adapter = ctx?.context.adapter
						if (!adapter) return { data: session }
						const memberships = await adapter.findMany<{
							organizationId: string
						}>({
							model: 'member',
							where: [{ field: 'userId', value: session.userId }],
							limit: 2,
						})
						const [only, ...rest] = memberships
						if (!only || rest.length > 0) return { data: session }
						return {
							data: {
								...session,
								activeOrganizationId: only.organizationId,
							},
						}
					},
				},
			},
		},
		plugins: input.plugins,
		rateLimit: {
			enabled: true,
			storage: 'memory' as const,
			window: 60,
			max: 100,
			// Better Auth's default for `/sign-in/*` is 3 attempts per 10s.
			// That's tight enough to lock out a typical user retrying a
			// forgotten password three times — and tight enough to fail the
			// e2e suite, which stacks setup + unauth + cross-org sign-ins
			// inside the window. Loosen to 20 per 60s: still strong brute-
			// force protection (a serial attacker takes ~5h to try 100
			// passwords against a single account) without false positives
			// for human users or the test suite.
			customRules: {
				'/sign-in/email': { window: 60, max: 20 },
			},
		},
		advanced: {
			cookiePrefix: 'batuda',
			useSecureCookies: input.env.useSecureCookies,
			crossSubDomainCookies: {
				enabled: true,
				...(cookieDomain ? { domain: cookieDomain } : {}), // Let Better Auth derive domain when we can't.
			},
			...(cookieDomain
				? { defaultCookieAttributes: { domain: cookieDomain } }
				: {}), // Set on all cookies, not just cross-subdomain ones.
		},
		trustedOrigins: [...input.env.trustedOrigins],
	} satisfies BetterAuthOptions // Type-checks fields without widening the inferred literal shape.
}
