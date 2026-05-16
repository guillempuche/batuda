import { BASE_ERROR_CODES } from '@better-auth/core/error'
import type { BetterAuthPlugin } from 'better-auth'
import {
	APIError,
	createAuthEndpoint,
	sensitiveSessionMiddleware,
} from 'better-auth/api'
import * as z from 'zod'

/**
 * Better Auth's built-in `setPassword` is a path-less admin escape hatch —
 * `authClient.setPassword` is not generated and `/auth/change-password`
 * refuses to set a first password by design. Without this route a
 * passwordless invitee has no way to bind their own credential row.
 *
 * Mounted at `POST /auth/set-password`. `sensitiveSessionMiddleware` forces
 * a fresh DB lookup so a cached cookie can't be replayed. Mirrors the core
 * implementation at docs/repos/better-auth/.../api/routes/update-user.ts:316,
 * including the `PASSWORD_ALREADY_SET` guard.
 */
export const setPasswordRoute = () => {
	return {
		id: 'set-password-route',
		endpoints: {
			setPassword: createAuthEndpoint(
				'/set-password',
				{
					method: 'POST',
					body: z.object({
						newPassword: z.string(),
					}),
					use: [sensitiveSessionMiddleware],
				},
				async ctx => {
					const { newPassword } = ctx.body
					const session = ctx.context.session
					const minLength = ctx.context.password.config.minPasswordLength
					const maxLength = ctx.context.password.config.maxPasswordLength
					if (newPassword.length < minLength) {
						throw APIError.from(
							'BAD_REQUEST',
							BASE_ERROR_CODES.PASSWORD_TOO_SHORT,
						)
					}
					if (newPassword.length > maxLength) {
						throw APIError.from(
							'BAD_REQUEST',
							BASE_ERROR_CODES.PASSWORD_TOO_LONG,
						)
					}
					const accounts = await ctx.context.internalAdapter.findAccounts(
						session.user.id,
					)
					const credential = accounts.find(
						account => account.providerId === 'credential' && account.password,
					)
					if (credential) {
						throw APIError.from(
							'BAD_REQUEST',
							BASE_ERROR_CODES.PASSWORD_ALREADY_SET,
						)
					}
					const passwordHash = await ctx.context.password.hash(newPassword)
					await ctx.context.internalAdapter.linkAccount({
						userId: session.user.id,
						providerId: 'credential',
						accountId: session.user.id,
						password: passwordHash,
					})
					return ctx.json({ status: true })
				},
			),
		},
	} satisfies BetterAuthPlugin
}
