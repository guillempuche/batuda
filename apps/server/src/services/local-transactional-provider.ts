import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Effect, Layer } from 'effect'

import { EmailSendError } from '@batuda/controllers'

import {
	type MagicLinkParams,
	TransactionalEmailProvider,
} from './transactional-email-provider.js'

// Anchor relative to this file so the inbox dir is the same one the
// `LocalInboxProvider` reader scans, regardless of cwd.
const INBOX_DIR = resolve(import.meta.dirname, '..', '..', '.dev-inbox')

const DEV_INBOX_FROM = 'dev@batuda.local'

const pad = (n: number, width = 2) => n.toString().padStart(width, '0')

// Numeric stamp that's safe on macOS Finder + Windows. The full ISO date
// stays in the frontmatter `sentAt` field for parsers.
const filenameStamp = (d: Date) =>
	`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50) || 'untitled'

const formatList = (items: readonly string[], indent = '  '): string => {
	if (items.length === 0) return '[]'
	return `\n${items.map(item => `${indent}- ${item}`).join('\n')}`
}

// On-disk format mirrors `local-inbox-provider.ts`'s writer so the same
// reader (frontmatter parser + `labels: magic-link` filter) surfaces the
// magic-link mail in the dev inbox without provider-specific glue.
const formatMagicLink = (args: {
	readonly sentAt: Date
	readonly messageId: string
	readonly threadId: string
	readonly to: string
	readonly subject: string
	readonly bodyText: string
}): string => {
	const fm = [
		`sentAt: ${args.sentAt.toISOString()}`,
		`provider: local-transactional`,
		`messageId: ${args.messageId}`,
		`threadId: ${args.threadId}`,
		`from: ${DEV_INBOX_FROM}`,
		`to: ${formatList([args.to])}`,
		`cc: []`,
		`bcc: []`,
		`replyTo: null`,
		`subject: ${args.subject}`,
		`text: ${args.bodyText}`,
		`html: null`,
		`labels: ${formatList(['magic-link'])}`,
		`attachments: []`,
	].join('\n')
	return `---\n${fm}\n---\n\n${args.bodyText}\n`
}

const ensureInboxDir = Effect.tryPromise({
	try: () => mkdir(INBOX_DIR, { recursive: true }),
	catch: e =>
		new EmailSendError({
			message: `local-transactional: cannot create ${INBOX_DIR}: ${e instanceof Error ? e.message : String(e)}`,
			kind: 'unknown',
			recipient: 'unknown',
		}),
})

// Writes a magic-link `.md` file under `apps/server/.dev-inbox/` so a
// developer can pick the URL up locally without sending real mail. The
// file's `labels: ['magic-link']` is what the dev-inbox reader keys on.
export const LocalTransactionalProviderLive = Layer.effect(
	TransactionalEmailProvider,
	Effect.gen(function* () {
		const sendMagicLink = (
			params: MagicLinkParams,
		): Effect.Effect<void, EmailSendError> =>
			Effect.gen(function* () {
				yield* ensureInboxDir
				const sentAt = new Date()
				const messageId = `msg_local_${randomUUID()}`
				const threadId = `thr_local_${randomUUID()}`
				const subject = 'Sign in to Batuda'
				const bodyText = `Click the link below to sign in:\n\n${params.url}\n\nThis link will expire shortly.\n\nToken: ${params.token}`
				const stamp = filenameStamp(sentAt)
				const filename = `${stamp}__${slugify(params.email)}__${slugify(subject)}.md`
				const path = resolve(INBOX_DIR, filename)
				const content = formatMagicLink({
					sentAt,
					messageId,
					threadId,
					to: params.email,
					subject,
					bodyText,
				})
				yield* Effect.tryPromise({
					try: () => writeFile(path, content, 'utf8'),
					catch: e =>
						new EmailSendError({
							message: `local-transactional: cannot write ${filename}: ${e instanceof Error ? e.message : String(e)}`,
							kind: 'unknown',
							recipient: params.email,
						}),
				})
				yield* Effect.logInfo(`local-transactional: wrote ${filename}`)
			})

		return { sendMagicLink } as const
	}),
)
