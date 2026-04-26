import type { Layer } from 'effect'

import { LocalInboxProviderLive } from './local-inbox-provider'

// Single live binding for the abstract `EmailProvider` tag. Real outbound
// SMTP / inbound IMAP transport ship in the mail-worker slice; until then,
// the local-inbox catcher (writes apps/server/.dev-inbox/*.md) is the only
// implementation.
export const EmailProviderLive: Layer.Layer<
	import('./email-provider.js').EmailProvider,
	never,
	never
> = LocalInboxProviderLive
