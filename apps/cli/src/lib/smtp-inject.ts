import { Effect } from 'effect'
import nodemailer from 'nodemailer'

// Shared SMTP injector into the dev mail catcher, used by the `email inject`
// CLI command for ad-hoc dev pokes and mirrored by an e2e helper for the
// IMAP-roundtrip spec. Not by the seed: it writes its demo messages straight to
// the database, so nothing it creates passes through the catcher. One transport
// per call — connection cost is negligible against the catcher on localhost and
// removes any cross-process state we'd otherwise have to manage.

export interface InjectAttachment {
	readonly filename: string
	readonly contentType: string
	readonly content: Buffer
}

export interface InjectedMessage {
	readonly to: string
	readonly from: string
	readonly subject: string
	readonly cc?: string | readonly string[]
	readonly bcc?: string | readonly string[]
	readonly text?: string
	readonly html?: string
	readonly inReplyTo?: string
	readonly references?: readonly string[]
	readonly attachments?: readonly InjectAttachment[]
	readonly headers?: Record<string, string>
}

export interface InjectResult {
	readonly messageId: string
}

const DEFAULT_SMTP_HOST = 'localhost'
const DEFAULT_SMTP_PORT = 1025

// The dev mail catcher accepts unauthenticated relay on the dev port.
// `secure: false` + `requireTLS: false` matches the inbox row's
// `smtpSecurity='plain'` so the demo round-trip mirrors what the worker does
// at runtime.
export const injectViaSmtp = (
	msg: InjectedMessage,
	options: {
		readonly host?: string
		readonly port?: number
	} = {},
): Effect.Effect<InjectResult, Error, never> =>
	Effect.tryPromise({
		try: async () => {
			const transport = nodemailer.createTransport({
				host: options.host ?? DEFAULT_SMTP_HOST,
				port: options.port ?? DEFAULT_SMTP_PORT,
				secure: false,
				requireTLS: false,
				auth: undefined,
			})
			try {
				const result = await transport.sendMail({
					to: msg.to,
					from: msg.from,
					subject: msg.subject,
					...(msg.cc !== undefined && {
						cc: typeof msg.cc === 'string' ? msg.cc : [...msg.cc],
					}),
					...(msg.bcc !== undefined && {
						bcc: typeof msg.bcc === 'string' ? msg.bcc : [...msg.bcc],
					}),
					...(msg.text !== undefined && { text: msg.text }),
					...(msg.html !== undefined && { html: msg.html }),
					...(msg.inReplyTo !== undefined && { inReplyTo: msg.inReplyTo }),
					...(msg.references !== undefined && {
						references: [...msg.references],
					}),
					...(msg.headers !== undefined && { headers: msg.headers }),
					...(msg.attachments !== undefined && {
						attachments: msg.attachments.map(a => ({
							filename: a.filename,
							contentType: a.contentType,
							content: a.content,
						})),
					}),
				})
				return { messageId: result.messageId }
			} finally {
				transport.close()
			}
		},
		catch: e =>
			new Error(`smtp-inject: ${e instanceof Error ? e.message : String(e)}`),
	})
