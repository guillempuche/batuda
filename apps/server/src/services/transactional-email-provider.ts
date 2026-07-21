import { Context, type Effect } from 'effect'

import type { EmailSendError } from '@batuda/controllers'

// System-originated transactional email — sign-in links, password resets, and
// the note telling someone they've been added to an organization. Kept
// separate from the BYO-mailbox `EmailProvider` because the deployment shape,
// reliability requirements, and operational tooling (DKIM/SPF on Batuda's
// domain vs the user's) don't overlap. CRM mailbox outage = one user
// complaining; transactional outage = nobody can log in.
//
// Every message carries the reader's stored language. It arrives as plain text
// because the column can hold anything; the template layer narrows it and
// falls back when it doesn't recognise the value.

export interface MagicLinkParams {
	readonly email: string
	readonly url: string
	readonly token: string
	readonly locale: string | null
}

// Reset-password URL bounces through BA's `/auth/reset-password/:token`
// callback endpoint (origin-checked) which then redirects to the frontend
// `/reset-password?token=...` page. `expiresAt` is BA's
// `resetPasswordTokenExpiresIn` (default 1 hour) — the template surfaces
// it so a returning user knows whether the link is still good.
export interface ResetPasswordParams {
	readonly email: string
	readonly url: string
	readonly expiresAt: Date
	readonly locale: string | null
}

// Sent when an admin adds someone to an organization. `signInUrl` points at
// the sign-in page, not at a link that authenticates: the reader signs in
// themselves and requests their own short-lived link. Nothing here expires, so
// there is no deadline to quote.
export interface MemberAddedParams {
	readonly email: string
	readonly addedByName: string
	readonly organizationName: string
	readonly signInUrl: string
	readonly locale: string | null
}

export class TransactionalEmailProvider extends Context.Service<
	TransactionalEmailProvider,
	{
		readonly sendMagicLink: (
			params: MagicLinkParams,
		) => Effect.Effect<void, EmailSendError>
		readonly sendMemberAdded: (
			params: MemberAddedParams,
		) => Effect.Effect<void, EmailSendError>
		readonly sendResetPassword: (
			params: ResetPasswordParams,
		) => Effect.Effect<void, EmailSendError>
	}
>()('TransactionalEmailProvider') {}
