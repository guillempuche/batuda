/**
 * Inject a canned RFC822 message into the local Mailpit. Useful for
 * eyeballing a wire-format payload in Mailpit's web UI (or for the
 * outbound-assertion side of e2e specs). Mailpit does not speak
 * IMAP, so the mail-worker cannot fetch what's injected here — DB
 * ingest never happens locally. The seed populates demo
 * `email_messages` rows directly via SQL instead.
 */

import { Console, Effect } from 'effect'

import { injectViaSmtp } from '../lib/smtp-inject'

interface InjectArgs {
	readonly to: string
	readonly from: string
	readonly subject: string
	readonly text: string | undefined
	readonly html: string | undefined
	readonly inReplyTo: string | undefined
	readonly host: string
	readonly port: number
}

export const emailInject = (args: InjectArgs) =>
	Effect.gen(function* () {
		const result = yield* injectViaSmtp(
			{
				to: args.to,
				from: args.from,
				subject: args.subject,
				...(args.text !== undefined && { text: args.text }),
				...(args.html !== undefined && { html: args.html }),
				...(args.inReplyTo !== undefined && { inReplyTo: args.inReplyTo }),
			},
			{ host: args.host, port: args.port },
		)
		yield* Console.log(`injected message-id=${result.messageId}`)
		yield* Console.log(
			'Visible at http://localhost:8025 — outbound only; not ingested into the DB (Mailpit has no IMAP).',
		)
	})
