/**
 * Inject a canned RFC822 message into the local mail catcher over SMTP.
 * Useful for eyeballing a wire-format payload via the catcher's REST API (or
 * for the outbound-assertion side of e2e specs). Addressed to a seeded inbox
 * with the mail-worker running, it is also ingested over IMAP; otherwise it
 * just sits in the catcher.
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Config, Console, Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { simpleParser } from 'mailparser'

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

// The object is not there, as opposed to the store refusing to answer. S3
// says so by name; some gateways only say 404.
const isObjectMissing = (cause: unknown): boolean => {
	if (typeof cause !== 'object' || cause === null) return false
	const name = (cause as { name?: unknown }).name
	if (name === 'NoSuchKey' || name === 'NotFound') return true
	const status = (cause as { $metadata?: { httpStatusCode?: unknown } })
		.$metadata?.httpStatusCode
	return status === 404
}

const describe = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause)

/**
 * Fill in the body of sent messages that have none stored, so their thread
 * shows something other than an empty card.
 *
 * The wire bytes in object storage are the only copy left on our side, so each
 * message is read back from there and its text and HTML lifted out. Only rows
 * that still have no body are touched, so it is safe to run twice.
 */
export const emailBackfillBodies = (args: { readonly dryRun: boolean }) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

		const pending = yield* sql<{
			id: string
			messageId: string
			rawRfc822Ref: string
		}>`
			SELECT id, message_id, raw_rfc822_ref
			FROM email_messages
			WHERE direction = 'outbound'
			  AND text_body IS NULL
			  AND html_body IS NULL
			  AND raw_rfc822_ref IS NOT NULL
			ORDER BY status_updated_at
		`

		if (pending.length === 0) {
			yield* Console.log('Nothing to fill in — every sent message has a body.')
			return
		}
		yield* Console.log(
			`${pending.length} sent message(s) without a body.${
				args.dryRun ? ' Showing what would change; nothing is written.' : ''
			}`,
		)

		const s3 = new S3Client({
			endpoint: yield* Config.string('STORAGE_ENDPOINT'),
			region: yield* Config.string('STORAGE_REGION'),
			credentials: {
				accessKeyId: yield* Config.string('STORAGE_ACCESS_KEY_ID'),
				secretAccessKey: Redacted.value(
					yield* Config.redacted('STORAGE_SECRET_ACCESS_KEY'),
				),
			},
			forcePathStyle: true,
		})
		const bucket = yield* Config.string('STORAGE_BUCKET')

		let filled = 0
		let unreadable = 0
		let unparseable = 0
		let empty = 0
		for (const row of pending) {
			// Only a genuinely absent object is expected here — storing those
			// bytes was best-effort, so some rows point at a copy that never
			// landed. Anything else (a wrong key, a refused bucket, a network
			// that is down) is a problem with the run itself, and reporting it
			// as a missing copy would send someone looking in the wrong place.
			const fetched = yield* Effect.tryPromise({
				try: async () => {
					const object = await s3.send(
						new GetObjectCommand({ Bucket: bucket, Key: row.rawRfc822Ref }),
					)
					const body = object.Body
					if (body === undefined) return null
					return Buffer.from(await body.transformToByteArray())
				},
				catch: cause => cause,
			}).pipe(
				Effect.catch(cause =>
					isObjectMissing(cause)
						? Effect.succeed(null)
						: Effect.fail(
								new Error(
									`could not read ${row.rawRfc822Ref}: ${describe(cause)}`,
								),
							),
				),
			)

			if (fetched === null) {
				unreadable++
				yield* Console.log(
					`  no stored copy: ${row.messageId} (${row.rawRfc822Ref})`,
				)
				continue
			}

			// One message that cannot be read must not strand the rest: the run
			// is idempotent, so stopping here would mean every later message
			// stays empty until somebody notices and deletes the offender.
			const mail = yield* Effect.tryPromise({
				try: () => simpleParser(fetched),
				catch: cause => cause,
			}).pipe(Effect.catch(() => Effect.succeed(null)))
			if (mail === null) {
				unparseable++
				yield* Console.log(`  stored copy will not parse: ${row.messageId}`)
				continue
			}

			const text = typeof mail.text === 'string' ? mail.text : null
			const html = mail.html === false ? null : (mail.html ?? null)
			// Counted apart from an unreadable one: the copy is there, it just
			// carries nothing to show, and that is a different thing to chase.
			if (text === null && html === null) {
				empty++
				yield* Console.log(`  stored copy has no body: ${row.messageId}`)
				continue
			}

			if (!args.dryRun) {
				yield* sql`
					UPDATE email_messages
					SET text_body = ${text},
					    html_body = ${html},
					    text_preview = ${text === null ? null : text.slice(0, 200)}
					WHERE id = ${row.id}
				`
			}
			filled++
			yield* Console.log(
				`  ${args.dryRun ? 'would fill' : 'filled'}: ${row.messageId}`,
			)
		}

		const skipped = [
			unreadable > 0 ? `${unreadable} with no stored copy` : null,
			unparseable > 0
				? `${unparseable} whose stored copy will not parse`
				: null,
			empty > 0 ? `${empty} whose stored copy has no body` : null,
		]
			.filter(part => part !== null)
			.join(', ')
		yield* Console.log(
			`${args.dryRun ? 'Would fill' : 'Filled'} ${filled}${
				skipped === '' ? '.' : `; skipped ${skipped}.`
			}`,
		)
	})
