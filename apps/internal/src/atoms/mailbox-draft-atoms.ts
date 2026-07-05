import { Atom } from 'effect/unstable/reactivity'

/**
 * In-progress draft for the "Connect mailbox" form, kept in a global atom so a
 * half-filled form survives closing the dialog and navigating away. The value
 * lives in the per-mount registry (see `<RegistryProvider>` in __root.tsx), so
 * a hard refresh starts fresh; the create handler also resets it on success.
 *
 * The mailbox password is deliberately NOT part of this draft — the secret
 * never enters the atom (nor the URL). It stays in the form's local state and
 * is read only on submit.
 *
 * The string-literal unions mirror the mailbox domain; they're duplicated here
 * (rather than imported from the route) to keep this atom free of UI imports.
 */

type MailboxPurpose = 'human' | 'agent' | 'shared'
type TransportSecurity = 'tls' | 'starttls' | 'plain'

export type MailboxDraft = {
	readonly email: string
	readonly displayName: string
	readonly purpose: MailboxPurpose
	readonly ownerUserId: string
	readonly isDefault: boolean
	readonly isPrivate: boolean
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: TransportSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: TransportSecurity
	readonly username: string
}

export const emptyMailboxDraft: MailboxDraft = {
	email: '',
	displayName: '',
	purpose: 'human',
	ownerUserId: '',
	isDefault: false,
	isPrivate: false,
	imapHost: '',
	imapPort: 993,
	imapSecurity: 'tls',
	smtpHost: '',
	smtpPort: 465,
	smtpSecurity: 'tls',
	username: '',
}

export const mailboxDraftAtom = Atom.make<MailboxDraft>(emptyMailboxDraft)
