import { type Effect, ServiceMap } from 'effect'

import type { EmailSendError } from '@batuda/controllers'

// System-originated transactional email — magic links today, password
// resets and invitation emails next. Kept separate from the BYO-mailbox
// `EmailProvider` because the deployment shape, reliability requirements,
// and operational tooling (DKIM/SPF on Batuda's domain vs the user's)
// don't overlap. CRM mailbox outage = one user complaining; transactional
// outage = nobody can log in.

export interface MagicLinkParams {
	readonly email: string
	readonly url: string
	readonly token: string
}

// Org invitation. `inviteUrl` is the magic-link URL minted by the BA
// `sendInvitationEmail` callback (per the Slice 5 plan), so a single
// click signs the invitee in AND lands them on /accept-invitation/<id>
// already authenticated. `expiresAt` is the invitation's expiry — the
// template surfaces it so the recipient knows by when they have to act.
export interface InvitationParams {
	readonly email: string
	readonly inviterName: string
	readonly organizationName: string
	readonly inviteUrl: string
	readonly expiresAt: Date
}

export class TransactionalEmailProvider extends ServiceMap.Service<
	TransactionalEmailProvider,
	{
		readonly sendMagicLink: (
			params: MagicLinkParams,
		) => Effect.Effect<void, EmailSendError>
		readonly sendInvitation: (
			params: InvitationParams,
		) => Effect.Effect<void, EmailSendError>
	}
>()('TransactionalEmailProvider') {}
