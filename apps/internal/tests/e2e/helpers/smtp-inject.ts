// Tiny SMTP-into-Mailpit injector for e2e specs that need to drive the
// inbound side of the mail-worker. Mirrors `apps/cli/src/lib/smtp-inject.ts`
// — the CLI helper sits behind an Effect API the seed uses, while this
// helper is a thin Promise wrapper specs can `await`. Both target the
// same dev compose service (Mailpit on localhost:1025).

import nodemailer from 'nodemailer'

const MAILPIT_SMTP_HOST = process.env['MAILPIT_SMTP_HOST'] ?? 'localhost'
const MAILPIT_SMTP_PORT = Number(process.env['MAILPIT_SMTP_PORT'] ?? '1025')

export interface InjectAttachment {
	readonly filename: string
	readonly contentType: string
	readonly content: Buffer
}

export interface InjectArgs {
	readonly to: string
	readonly from: string
	readonly subject: string
	readonly text?: string
	readonly html?: string
	readonly inReplyTo?: string
	readonly references?: readonly string[]
	readonly attachments?: readonly InjectAttachment[]
	readonly headers?: Record<string, string>
}

export async function injectViaSmtp(
	msg: InjectArgs,
): Promise<{ messageId: string }> {
	const transport = nodemailer.createTransport({
		host: MAILPIT_SMTP_HOST,
		port: MAILPIT_SMTP_PORT,
		secure: false,
		requireTLS: false,
		auth: undefined,
		tls: { rejectUnauthorized: false },
	})
	try {
		const result = await transport.sendMail({
			to: msg.to,
			from: msg.from,
			subject: msg.subject,
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
}
