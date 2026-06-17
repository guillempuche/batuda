/**
 * Inject a canned RFC822 message into the local mail catcher over SMTP.
 * Useful for eyeballing a wire-format payload via the catcher's REST API (or
 * for the outbound-assertion side of e2e specs). Addressed to a seeded inbox
 * with the mail-worker running, it is also ingested over IMAP; otherwise it
 * just sits in the catcher.
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
			'Visible via the mail-catcher REST API at http://localhost:8025.',
		)
	})
