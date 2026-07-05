import { Buffer } from 'node:buffer'

import { Effect, Layer, ServiceMap } from 'effect'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

import {
	type ChannelTransport,
	EMAIL_CAPABILITIES,
	type OutboundMessage,
	Sent,
} from '@batuda/communications'
import { GrantAuthFailed, GrantConnectFailed } from '@batuda/controllers'

import type { OauthProvider } from './email-oauth.js'

// ── Types the transport speaks in ─────────────────────────────
// `OutboundMessage`/`OutboundAttachment` + the `Sent` outcome now live in the
// channel-agnostic spine (`@batuda/communications`); this transport is the
// email implementation of its `ChannelTransport` port.

export type MailSecurity = 'tls' | 'starttls' | 'plain'

// How a connection authenticates: a password for imap-smtp, or a short-lived
// XOAUTH2 access token for the OAuth providers. A discriminated union so the
// wire builders pick the right nodemailer / ImapFlow auth shape.
export type ConnectionAuth =
	| { readonly kind: 'password'; readonly password: string }
	| { readonly kind: 'xoauth2'; readonly accessToken: string }

export interface DecryptedCreds {
	readonly connectionId: string
	readonly imapHost: string
	readonly imapPort: number
	readonly imapSecurity: MailSecurity
	readonly smtpHost: string
	readonly smtpPort: number
	readonly smtpSecurity: MailSecurity
	readonly username: string
	readonly auth: ConnectionAuth
}

// Interpret a decrypted config blob by the connection's provider: imap-smtp
// blobs are the raw password; OAuth blobs are {accessToken, refreshToken} JSON,
// and we authenticate with the stored access token, which the token refresher
// (mailbox-token-refresher) keeps fresh out of band: sends and probes re-read
// the config each time, so an expired token is rewritten before it is used.
export const connectionAuth = (
	provider: OauthProvider | 'imap-smtp',
	blob: string,
): ConnectionAuth => {
	if (provider === 'imap-smtp') {
		return { kind: 'password', password: blob }
	}
	let parsed: { accessToken?: unknown }
	try {
		parsed = JSON.parse(blob) as { accessToken?: unknown }
	} catch {
		throw new Error(`corrupt OAuth config for the ${provider} connection`)
	}
	if (
		typeof parsed.accessToken !== 'string' ||
		parsed.accessToken.length === 0
	) {
		throw new Error(
			`OAuth config for the ${provider} connection has no access token`,
		)
	}
	return { kind: 'xoauth2', accessToken: parsed.accessToken }
}

// ── Error-classification helpers ──────────────────────────────

// nodemailer surfaces SMTP failures as Error objects with a numeric or
// 5-char code on `.responseCode` / `.code`. We treat anything in the
// 5xx auth family as auth_failed; anything that didn't get past the
// socket as connect_failed; the rest as connect_failed too (caller can
// differentiate via `detail`).
//
// `detail` aggregates every nodemailer field we've seen carry useful
// information so the persisted error string (and the test error
// context) reads `code=ECONNECTION command=CONN response=… message=…`
// instead of the empty-string detail nodemailer hands back when only
// the `responseCode` is meaningful.
const formatSmtpDetail = (err: unknown): string | null => {
	if (typeof err !== 'object' || err === null) return null
	const e = err as {
		code?: string
		responseCode?: number
		command?: string
		response?: string
		message?: string
	}
	const parts: Array<string> = []
	if (e.code) parts.push(`code=${e.code}`)
	if (e.responseCode !== undefined) parts.push(`responseCode=${e.responseCode}`)
	if (e.command) parts.push(`command=${e.command}`)
	if (e.response) parts.push(`response=${e.response}`)
	if (e.message) parts.push(`message=${e.message}`)
	return parts.length === 0 ? null : parts.join(' ')
}

const classifySmtpError = (
	err: unknown,
	mailboxId: string,
): GrantAuthFailed | GrantConnectFailed => {
	const e = err as { code?: string; responseCode?: number }
	const detail = formatSmtpDetail(err)
	if (e?.code === 'EAUTH' || e?.responseCode === 535) {
		return new GrantAuthFailed({ mailboxId, detail })
	}
	return new GrantConnectFailed({ mailboxId, detail })
}

const classifyImapError = (
	err: unknown,
	mailboxId: string,
): GrantAuthFailed | GrantConnectFailed => {
	const e = err as {
		authenticationFailed?: boolean
		code?: string
	}
	const detail = formatSmtpDetail(err)
	if (e?.authenticationFailed === true || e?.code === 'AUTHENTICATIONFAILED') {
		return new GrantAuthFailed({ mailboxId, detail })
	}
	return new GrantConnectFailed({ mailboxId, detail })
}

// ── Wire builders ─────────────────────────────────────────────

const buildSmtpTransport = (creds: DecryptedCreds) =>
	nodemailer.createTransport({
		host: creds.smtpHost,
		port: creds.smtpPort,
		secure: creds.smtpSecurity === 'tls',
		requireTLS: creds.smtpSecurity === 'starttls',
		auth:
			creds.auth.kind === 'xoauth2'
				? {
						type: 'OAuth2',
						user: creds.username,
						accessToken: creds.auth.accessToken,
					}
				: { user: creds.username, pass: creds.auth.password },
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
		auth:
			creds.auth.kind === 'xoauth2'
				? { user: creds.username, accessToken: creds.auth.accessToken }
				: { user: creds.username, pass: creds.auth.password },
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
						catch: err => classifyImapError(err, creds.connectionId),
					})
					yield* Effect.promise(() => imap.logout()).pipe(
						Effect.catchCause(() => Effect.void),
					)

					const smtp = buildSmtpTransport(creds)
					yield* Effect.tryPromise({
						try: () => smtp.verify(),
						catch: err => classifySmtpError(err, creds.connectionId),
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
						catch: err => classifySmtpError(err, creds.connectionId),
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
						catch: err => classifySmtpError(err, creds.connectionId),
					}).pipe(Effect.ensuring(Effect.sync(() => transport.close())))

					return new Sent({
						messageId,
						raw: new Uint8Array(raw),
					})
				})

			const appendToSent = (creds: DecryptedCreds, raw: Uint8Array) =>
				Effect.gen(function* () {
					const imap = openImapClient(creds)
					yield* Effect.tryPromise({
						try: () => imap.connect(),
						catch: err => classifyImapError(err, creds.connectionId),
					})
					yield* Effect.tryPromise({
						try: async () => {
							// Most providers expose a "Sent" mailbox; Gmail uses
							// "[Gmail]/Sent Mail" — imapflow's special-use lookup
							// resolves either via the SPECIAL-USE attribute. Dev mail
							// catchers (GreenMail) and providers without a Sent folder
							// resolve neither; skip the APPEND (the message already went
							// out over SMTP) instead of erroring.
							const box =
								(await imap
									.getMailboxLock('Sent', { readOnly: false })
									.catch(() => null)) ??
								(await imap
									.getMailboxLock('[Gmail]/Sent Mail', { readOnly: false })
									.catch(() => null))
							if (!box) return
							try {
								await imap.append('Sent', Buffer.from(raw), ['\\Seen'])
							} finally {
								box.release()
							}
						},
						catch: err => classifyImapError(err, creds.connectionId),
					}).pipe(Effect.ensuring(Effect.promise(() => imap.logout())))
				})

			return {
				capabilities: EMAIL_CAPABILITIES,
				probe,
				send,
				appendToSent,
			} satisfies ChannelTransport<
				DecryptedCreds,
				GrantAuthFailed | GrantConnectFailed
			>
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
