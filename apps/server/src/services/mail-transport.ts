import { Buffer } from 'node:buffer'

import { Effect, Layer, ServiceMap } from 'effect'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

import { GrantAuthFailed, GrantConnectFailed } from '@batuda/controllers'

// ── Types the transport speaks in ─────────────────────────────

export type MailSecurity = 'tls' | 'starttls' | 'plain'

export interface DecryptedCreds {
	readonly inboxId: string
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: MailSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: MailSecurity
	readonly username: string
	readonly password: string
}

export interface OutboundAttachment {
	readonly filename: string
	readonly contentType: string
	readonly contentBase64: string
	readonly contentId?: string | undefined
	readonly disposition?: 'inline' | 'attachment' | undefined
}

export interface OutboundMessage {
	readonly from: string
	readonly to: readonly string[]
	readonly cc?: readonly string[] | undefined
	readonly bcc?: readonly string[] | undefined
	readonly replyTo?: readonly string[] | undefined
	readonly subject: string
	readonly text?: string | undefined
	readonly html?: string | undefined
	readonly inReplyTo?: string | undefined
	readonly references?: readonly string[] | undefined
	readonly headers?: Readonly<Record<string, string>> | undefined
	readonly attachments?: readonly OutboundAttachment[] | undefined
}

export interface SentResult {
	// RFC 5322 Message-ID returned by the SMTP serializer (with `<>`).
	readonly messageId: string
	// Wire bytes nodemailer produced — the same payload IMAP APPENDs to
	// "Sent" so the server-side Sent folder mirrors what the recipient
	// actually saw.
	readonly raw: Uint8Array
}

// ── Error-classification helpers ──────────────────────────────

// nodemailer surfaces SMTP failures as Error objects with a numeric or
// 5-char code on `.responseCode` / `.code`. We treat anything in the
// 5xx auth family as auth_failed; anything that didn't get past the
// socket as connect_failed; the rest as connect_failed too (caller can
// differentiate via `detail`).
const classifySmtpError = (
	err: unknown,
	inboxId: string,
): GrantAuthFailed | GrantConnectFailed => {
	const e = err as { code?: string; responseCode?: number; message?: string }
	const detail = e?.message ?? null
	if (e?.code === 'EAUTH' || e?.responseCode === 535) {
		return new GrantAuthFailed({ inboxId, detail })
	}
	return new GrantConnectFailed({ inboxId, detail })
}

const classifyImapError = (
	err: unknown,
	inboxId: string,
): GrantAuthFailed | GrantConnectFailed => {
	const e = err as {
		authenticationFailed?: boolean
		code?: string
		message?: string
	}
	const detail = e?.message ?? null
	if (e?.authenticationFailed === true || e?.code === 'AUTHENTICATIONFAILED') {
		return new GrantAuthFailed({ inboxId, detail })
	}
	return new GrantConnectFailed({ inboxId, detail })
}

// ── Wire builders ─────────────────────────────────────────────

const buildSmtpTransport = (creds: DecryptedCreds) =>
	nodemailer.createTransport({
		host: creds.smtpHost,
		port: creds.smtpPort,
		secure: creds.smtpSecurity === 'tls',
		requireTLS: creds.smtpSecurity === 'starttls',
		auth: { user: creds.username, pass: creds.password },
		// 5s socket-level guard so a dead host fails the probe fast
		// instead of hanging the request thread.
		connectionTimeout: 5_000,
		greetingTimeout: 5_000,
		socketTimeout: 15_000,
	})

const openImapClient = (creds: DecryptedCreds): ImapFlow =>
	new ImapFlow({
		host: creds.imapHost,
		port: creds.imapPort,
		secure: creds.imapSecurity === 'tls',
		auth: { user: creds.username, pass: creds.password },
		// imapflow logs every protocol line at info — silence in prod
		// so the structured Effect log isn't drowned in low-level chatter.
		logger: false,
	})

// ── Tag ───────────────────────────────────────────────────────

export class MailTransport extends ServiceMap.Service<MailTransport>()(
	'MailTransport',
	{
		make: Effect.sync(() => {
			const probe = (creds: DecryptedCreds) =>
				Effect.gen(function* () {
					// IMAP first because IMAP rejects credentials more loudly
					// than SMTP (some providers accept SMTP without auth probes).
					const imap = openImapClient(creds)
					yield* Effect.tryPromise({
						try: () => imap.connect(),
						catch: err => classifyImapError(err, creds.inboxId),
					})
					yield* Effect.promise(() => imap.logout()).pipe(
						Effect.catchCause(() => Effect.void),
					)

					const smtp = buildSmtpTransport(creds)
					yield* Effect.tryPromise({
						try: () => smtp.verify(),
						catch: err => classifySmtpError(err, creds.inboxId),
					})
					smtp.close()
				})

			const send = (creds: DecryptedCreds, message: OutboundMessage) =>
				Effect.gen(function* () {
					const headers: Record<string, string> = {
						...(message.headers ?? {}),
					}
					if (message.inReplyTo) headers['In-Reply-To'] = message.inReplyTo
					if (message.references && message.references.length > 0) {
						headers['References'] = message.references.join(' ')
					}
					const mailOpts: Parameters<
						ReturnType<typeof buildSmtpTransport>['sendMail']
					>[0] = {
						from: message.from,
						to: [...message.to],
						cc: message.cc ? [...message.cc] : undefined,
						bcc: message.bcc ? [...message.bcc] : undefined,
						replyTo: message.replyTo ? [...message.replyTo] : undefined,
						subject: message.subject,
						text: message.text,
						html: message.html,
						headers,
						attachments: message.attachments?.map(a => ({
							filename: a.filename,
							contentType: a.contentType,
							content: Buffer.from(a.contentBase64, 'base64'),
							cid: a.contentId,
							contentDisposition: a.disposition,
						})),
					}

					// Compile to bytes via streamTransport so we capture exactly
					// what the wire will carry — then ship those bytes through
					// SMTP and APPEND the same payload to "Sent". Composing
					// twice would risk header drift (Date, Message-ID, boundary
					// strings differ on each compile).
					const compiler = nodemailer.createTransport({
						streamTransport: true,
						buffer: true,
					})
					const compiled = yield* Effect.tryPromise({
						try: () => compiler.sendMail(mailOpts),
						catch: err => classifySmtpError(err, creds.inboxId),
					})
					const raw = compiled.message as Buffer
					const messageId = compiled.messageId ?? ''

					const transport = buildSmtpTransport(creds)
					yield* Effect.tryPromise({
						try: () =>
							transport.sendMail({
								envelope: {
									from: message.from,
									to: [
										...message.to,
										...(message.cc ?? []),
										...(message.bcc ?? []),
									],
								},
								raw,
							}),
						catch: err => classifySmtpError(err, creds.inboxId),
					}).pipe(Effect.ensuring(Effect.sync(() => transport.close())))

					return {
						messageId,
						raw: new Uint8Array(raw),
					} satisfies SentResult
				})

			const appendToSent = (creds: DecryptedCreds, raw: Uint8Array) =>
				Effect.gen(function* () {
					const imap = openImapClient(creds)
					yield* Effect.tryPromise({
						try: () => imap.connect(),
						catch: err => classifyImapError(err, creds.inboxId),
					})
					yield* Effect.tryPromise({
						try: async () => {
							// Most providers expose a "Sent" mailbox; Gmail uses
							// "[Gmail]/Sent Mail" — imapflow's special-use lookup
							// resolves either via the SPECIAL-USE attribute.
							const box =
								(await imap
									.getMailboxLock('Sent', { readOnly: false })
									.catch(() => null)) ??
								(await imap.getMailboxLock('[Gmail]/Sent Mail', {
									readOnly: false,
								}))
							try {
								await imap.append('Sent', Buffer.from(raw), ['\\Seen'])
							} finally {
								box.release()
							}
						},
						catch: err => classifyImapError(err, creds.inboxId),
					}).pipe(Effect.ensuring(Effect.promise(() => imap.logout())))
				})

			return { probe, send, appendToSent } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
