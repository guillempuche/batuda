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

export class TransactionalEmailProvider extends ServiceMap.Service<
	TransactionalEmailProvider,
	{
		readonly sendMagicLink: (
			params: MagicLinkParams,
		) => Effect.Effect<void, EmailSendError>
	}
>()('TransactionalEmailProvider') {}
