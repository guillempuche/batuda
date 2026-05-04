/**
 * Inject a canned RFC822 message into the local Mailpit so the
 * mail-worker's IDLE picks it up via IMAP and produces real
 * `email_messages` rows. Exists for ad-hoc dev pokes and as the
 * building block the seed reuses to populate demo inboxes.
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
			'Run `pnpm dev` (or check `pnpm cli services status`) and the mail-worker will ingest within ~5s.',
		)
	})
