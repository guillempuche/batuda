import { Buffer } from 'node:buffer'

import { Context, DateTime, Effect, Layer } from 'effect'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

import {
	GrantAuthFailed,
	GrantConnectFailed,
	type GrantFailureReason,
} from '@batuda/controllers'

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
// 5-char code on `.responseCode` / `.code`. `EAUTH` and 535 are the whole of
// what counts as a refused sign-in; everything else did not get through.
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

const TIMEOUT_CODES = new Set([
	// Not a typo for each other: the mail sender spells it the first way, the
	// mailbox reader the second.
	'ETIMEDOUT',
	'ETIMEOUT',
	'CONNECT_TIMEOUT',
	'GREETING_TIMEOUT',
	// A server that stalls partway through securing a STARTTLS connection.
	'UPGRADE_TIMEOUT',
])
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN'])
const UNREACHABLE_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ECONNECTION',
	'EConnectionClosed',
	'EHOSTUNREACH',
	'ENETUNREACH',
])
// A refused certificate and a port that does not speak TLS read as a wrong
// password unless they are named, and they arrive under several names:
// nodemailer wraps its own as `ESOCKET`, Node's TLS layer reports its own.
const TLS_CODES = new Set([
	'ESOCKET',
	'EPROTO',
	'CERT_HAS_EXPIRED',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'ERR_TLS_CERT_ALTNAME_INVALID',
])
const isTlsCode = (code: string): boolean =>
	TLS_CODES.has(code) ||
	code.startsWith('ERR_TLS_') ||
	code.startsWith('ERR_SSL_')

// Only this fixed set is safe to count and write down anywhere; the mail
// server's own words stay in `detail`.
const reasonForCode = (code: string | undefined): GrantFailureReason => {
	if (code === undefined) return 'unknown'
	if (TIMEOUT_CODES.has(code)) return 'timeout'
	if (DNS_CODES.has(code)) return 'dns'
	if (UNREACHABLE_CODES.has(code)) return 'unreachable'
	if (isTlsCode(code)) return 'tls'
	return 'unknown'
}

const codeOf = (err: unknown): string | undefined =>
	typeof err === 'object' && err !== null
		? (err as { code?: string }).code
		: undefined

const classifySmtpError = (
	err: unknown,
	inboxId: string,
): GrantAuthFailed | GrantConnectFailed => {
	const e = err as { code?: string; responseCode?: number }
	const detail = formatSmtpDetail(err)
	if (e?.code === 'EAUTH' || e?.responseCode === 535) {
		return new GrantAuthFailed({
			inboxId,
			detail,
			reason: 'invalid_credentials',
		})
	}
	return new GrantConnectFailed({
		inboxId,
		detail,
		reason: reasonForCode(e?.code),
	})
}

const classifyImapError = (
	err: unknown,
	inboxId: string,
): GrantAuthFailed | GrantConnectFailed => {
	// imapflow keeps the server's status word on `serverResponseCode`; `code`
	// is where it puts what stopped the connection.
	const e = err as {
		authenticationFailed?: boolean
		serverResponseCode?: string
		code?: string
	}
	const detail = formatSmtpDetail(err)
	if (
		e?.authenticationFailed === true ||
		e?.serverResponseCode === 'AUTHENTICATIONFAILED'
	) {
		return new GrantAuthFailed({
			inboxId,
			detail,
			reason: 'invalid_credentials',
		})
	}
	return new GrantConnectFailed({
		inboxId,
		detail,
		reason: reasonForCode(e?.code),
	})
}

// ── Wire builders ─────────────────────────────────────────────

// How long a send may wait. Short, because a send is retried three times on
// top of this. The socket timer is looser: cutting a send short can leave the
// server accepting a message the client stopped listening for, which the retry
// then sends again.
const SEND_BUDGET = {
	connectionTimeout: 5_000,
	greetingTimeout: 5_000,
	socketTimeout: 15_000,
} as const

// A probe is more patient than a send, because failing one is expensive: a
// mailbox that comes back unreachable is refused every send until a later
// check clears it. So the wait for a server to say hello is no shorter than
// the mail libraries allow themselves, since a busy server is slow at exactly
// that and must not be read as a dead one. Getting the connection up is held
// far tighter than they would: a handshake that slow is a host nobody reaches.
const PROBE_BUDGET = {
	connectionTimeout: 10_000,
	greetingTimeout: 10_000,
	socketTimeout: 15_000,
} as const

// Filing the copy of a message that has already gone out carries the whole
// message, so it is given room to finish.
const UPLOAD_BUDGET = {
	connectionTimeout: 30_000,
	greetingTimeout: 30_000,
	socketTimeout: 300_000,
} as const

// The longest a probe may take, and the only bound on it: the timers above
// fail a dead host in seconds, but the socket one measures silence and starts
// again on every byte, so a server that dribbles out a reply forever is held
// by nothing else. One slow leg can spend all of it and leave the other none.
const PROBE_DEADLINE = '45 seconds'

const buildSmtpTransport = (
	creds: DecryptedCreds,
	budget: typeof SEND_BUDGET | typeof PROBE_BUDGET | typeof UPLOAD_BUDGET,
) =>
	nodemailer.createTransport({
		host: creds.smtpHost,
		port: creds.smtpPort,
		secure: creds.smtpSecurity === 'tls',
		requireTLS: creds.smtpSecurity === 'starttls',
		auth: { user: creds.username, pass: creds.password },
		...budget,
	})

// imapflow tears the connection down before reporting why, and tearing down
// rejects the call in flight with its own "Unexpected close", so the reason
// only ever reaches the 'error' listener. Held weakly, so a dropped client
// takes its entry with it.
const lastClientError = new WeakMap<ImapFlow, unknown>()

// imapflow's own name for "something closed this while you were waiting".
const isClosedDuringCall = (err: unknown): boolean =>
	(codeOf(err) ?? '').startsWith('ClosedAfterConnect')

// Node throws when a client emits 'error' and nothing is listening, which
// would take the whole process down long after whoever opened the client
// walked away.
const onImapClientError =
	(client: ImapFlow, inboxId: string) =>
	(error: unknown): void => {
		lastClientError.set(client, error)
		// Outside any fiber the logger is out of reach, so this goes straight to
		// the process's error stream and no further — it is a last resort for a
		// connection nobody is waiting on any more. A failure that happens while
		// somebody is waiting travels back through the record above instead, and
		// is the one that reaches the traces. Only the sort of failure goes down:
		// the server's words are about somebody's account.
		console.warn(
			JSON.stringify({
				level: 'WARN',
				message: 'imap client error',
				timestamp: DateTime.formatIso(DateTime.nowUnsafe()),
				annotations: {
					event: 'inbox.imap_client_error',
					inboxId,
					reason: reasonForCode(codeOf(error)),
				},
			}),
		)
	}

const openImapClient = (
	creds: DecryptedCreds,
	budget: typeof SEND_BUDGET | typeof PROBE_BUDGET | typeof UPLOAD_BUDGET,
): ImapFlow => {
	const client = new ImapFlow({
		host: creds.imapHost,
		port: creds.imapPort,
		secure: creds.imapSecurity === 'tls',
		auth: { user: creds.username, pass: creds.password },
		// imapflow logs every protocol line at info — silence in prod
		// so the structured Effect log isn't drowned in low-level chatter.
		logger: false,
		...budget,
	})
	client.on('error', onImapClientError(client, creds.inboxId))
	return client
}

const realImapFailure = (client: ImapFlow, thrown: unknown): unknown =>
	isClosedDuringCall(thrown) ? (lastClientError.get(client) ?? thrown) : thrown

// ── Tag ───────────────────────────────────────────────────────

export class MailTransport extends Context.Service<MailTransport>()(
	'MailTransport',
	{
		make: Effect.sync(() => {
			// Closing is paired with opening, so a leg that fails — or one the
			// deadline cuts short — still hands its connection back, and a close
			// that raises cannot stand in for the reason the probe failed.
			const probe = (creds: DecryptedCreds) =>
				Effect.gen(function* () {
					// IMAP first because IMAP rejects credentials more loudly
					// than SMTP (some providers accept SMTP without auth probes).
					yield* Effect.acquireUseRelease(
						Effect.sync(() => openImapClient(creds, PROBE_BUDGET)),
						imap =>
							Effect.gen(function* () {
								yield* Effect.tryPromise({
									try: () => imap.connect(),
									catch: err =>
										classifyImapError(
											realImapFailure(imap, err),
											creds.inboxId,
										),
								})
								yield* Effect.promise(() => imap.logout()).pipe(
									Effect.ignoreCause,
								)
							}),
						imap => Effect.sync(() => imap.close()).pipe(Effect.ignoreCause),
					)

					yield* Effect.acquireUseRelease(
						Effect.sync(() => buildSmtpTransport(creds, PROBE_BUDGET)),
						smtp =>
							Effect.tryPromise({
								try: () => smtp.verify(),
								catch: err => classifySmtpError(err, creds.inboxId),
							}),
						smtp => Effect.sync(() => smtp.close()).pipe(Effect.ignoreCause),
					)
				}).pipe(
					Effect.timeoutOrElse({
						duration: PROBE_DEADLINE,
						orElse: () =>
							Effect.fail(
								new GrantConnectFailed({
									inboxId: creds.inboxId,
									detail: null,
									reason: 'timeout',
								}),
							),
					}),
				)

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

					const transport = buildSmtpTransport(creds, SEND_BUDGET)
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

			// Paired the same way as in the probe, and the message has already gone
			// out over SMTP by the time this runs — a fault raised while filing the
			// copy would report a send that worked as one that did not.
			const appendToSent = (creds: DecryptedCreds, raw: Uint8Array) =>
				Effect.acquireUseRelease(
					Effect.sync(() => openImapClient(creds, UPLOAD_BUDGET)),
					imap =>
						Effect.gen(function* () {
							yield* Effect.tryPromise({
								try: () => imap.connect(),
								catch: err =>
									classifyImapError(realImapFailure(imap, err), creds.inboxId),
							})
							yield* Effect.tryPromise({
								try: async () => {
									// Ask the server which of its folders holds sent mail rather
									// than guessing at the name: Gmail calls it
									// "[Gmail]/Sent Mail" and Outlook "Sent Items". Dev mail
									// catchers (GreenMail) and providers without one have no
									// answer; skip the APPEND (the message already went out over
									// SMTP) instead of erroring.
									const boxes = await imap.list().catch(() => [])
									const sentPath =
										boxes.find(entry => entry.specialUse === '\\Sent')?.path ??
										boxes.find(entry => entry.path === 'Sent')?.path
									if (sentPath === undefined) return
									const box = await imap
										.getMailboxLock(sentPath, { readOnly: false })
										.catch(() => null)
									if (!box) return
									try {
										await imap.append(sentPath, Buffer.from(raw), ['\\Seen'])
									} finally {
										box.release()
									}
								},
								catch: err =>
									classifyImapError(realImapFailure(imap, err), creds.inboxId),
							})
							yield* Effect.promise(() => imap.logout()).pipe(
								Effect.ignoreCause,
							)
						}),
					imap => Effect.sync(() => imap.close()).pipe(Effect.ignoreCause),
				)

			return { probe, send, appendToSent } as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
