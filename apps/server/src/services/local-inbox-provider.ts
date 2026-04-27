import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'

import { Effect, Layer } from 'effect'

import { EmailError, EmailSendError } from '@batuda/controllers'

import {
	type CreateDraftParams,
	type CreateInboxParams,
	EmailProvider,
	type ListParams,
	type ProviderAttachmentMeta,
	type ProviderAttachmentStream,
	type ProviderDraft,
	type ProviderDraftItem,
	type ProviderInbox,
	type ProviderMessage,
	type ProviderMessageItem,
	type ProviderThread,
	type ProviderThreadItem,
	type ReplyParams,
	type SendAttachmentInput,
	type SendParams,
	type SendResult,
	type UpdateDraftParams,
} from './email-provider.js'

// ── Synthetic dev inbox identity ──
//
// The local catcher exposes exactly one inbox so that handlers/services that
// call `listInboxes()` get a non-empty result without dragging real data into
// dev. The inboxId is stable so cached references survive a server restart.

const DEV_INBOX_ID = 'inbox_dev_local'
const DEV_INBOX_EMAIL = 'dev@batuda.local'
const DEV_INBOX_DISPLAY_NAME = 'Local dev inbox'
const DEV_INBOX_CREATED_AT = new Date('2024-01-01T00:00:00Z')

// Anchor relative to this file (apps/server/src/services/) so the inbox dir
// always lives at apps/server/.dev-inbox regardless of where the process was
// started from (root, apps/server, ...). Using process.cwd() doubled the path
// when running via `pnpm --filter @batuda/server dev`.
const INBOX_DIR = resolve(import.meta.dirname, '..', '..', '.dev-inbox')
const DRAFTS_DIR = resolve(INBOX_DIR, 'drafts')
const ATTACHMENTS_DIR = resolve(INBOX_DIR, 'attachments')

// ── Filename + slug helpers ──

const pad = (n: number, width = 2) => n.toString().padStart(width, '0')

/**
 * `<YYYYMMDD-HHMMSS-mmm>` — colon-free numeric stamp safe for macOS Finder
 * and Windows. The full ISO timestamp is preserved inside the frontmatter.
 */
const filenameStamp = (d: Date) =>
	`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50) || 'untitled'

const firstRecipient = (to: string | string[]): string =>
	Array.isArray(to) ? (to[0] ?? 'unknown') : to

// ── Frontmatter parsing ──

interface StoredAttachment {
	readonly attachmentId: string
	readonly filename: string
	readonly contentType: string
	readonly size: number
}

interface MessageRecord {
	readonly sentAt: string
	readonly messageId: string
	readonly threadId: string
	readonly from: string
	readonly to: string[]
	readonly cc: string[]
	readonly bcc: string[]
	readonly replyTo: string | null
	readonly subject: string
	readonly text: string | null
	readonly html: string | null
	readonly labels: string[]
	readonly bodyText: string
	readonly attachments: StoredAttachment[]
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/**
 * Tiny YAML reader — only handles the flat keys we write ourselves
 * (string, list, null). Adding a real YAML lib would be overkill for a
 * dev-only catcher; if this ever needs nested structures, swap to `yaml`.
 */
const parseFrontmatter = (raw: string): MessageRecord => {
	const match = FRONTMATTER_RE.exec(raw)
	if (!match) {
		throw new Error('local-inbox: file is missing YAML frontmatter')
	}
	const fm = match[1] ?? ''
	const body = match[2] ?? ''
	const fields: Record<string, string | string[] | null> = {}
	const lines = fm.split('\n')
	let currentList: { key: string; items: string[] } | null = null

	for (const line of lines) {
		if (line.startsWith('  - ') && currentList) {
			currentList.items.push(line.slice(4).trim())
			continue
		}
		if (currentList) {
			fields[currentList.key] = currentList.items
			currentList = null
		}
		const colon = line.indexOf(':')
		if (colon === -1) continue
		const key = line.slice(0, colon).trim()
		const value = line.slice(colon + 1).trim()
		if (value === '') {
			currentList = { key, items: [] }
		} else if (value === '[]') {
			fields[key] = []
		} else if (value === 'null') {
			fields[key] = null
		} else {
			fields[key] = value
		}
	}
	if (currentList) fields[currentList.key] = currentList.items

	const asString = (k: string, fallback = ''): string => {
		const v = fields[k]
		return typeof v === 'string' ? v : fallback
	}
	const asNullableString = (k: string): string | null => {
		const v = fields[k]
		if (v === null) return null
		return typeof v === 'string' ? v : null
	}
	const asList = (k: string): string[] => {
		const v = fields[k]
		return Array.isArray(v) ? v : []
	}

	// Attachments serialize as `id=...|filename=...|contentType=...|size=...`
	// in the per-item list. Round-trip keeps the on-disk format greppable.
	const parseAttachment = (line: string): StoredAttachment | null => {
		const parts = Object.fromEntries(
			line.split('|').map(kv => {
				const eq = kv.indexOf('=')
				return eq === -1
					? [kv.trim(), '']
					: [kv.slice(0, eq).trim(), kv.slice(eq + 1).trim()]
			}),
		)
		if (!parts['id'] || !parts['filename']) return null
		return {
			attachmentId: parts['id'],
			filename: parts['filename'],
			contentType: parts['contentType'] ?? 'application/octet-stream',
			size: Number(parts['size'] ?? 0),
		}
	}
	const attachments = asList('attachments')
		.map(parseAttachment)
		.filter((a): a is StoredAttachment => a !== null)

	return {
		sentAt: asString('sentAt', new Date().toISOString()),
		messageId: asString('messageId'),
		threadId: asString('threadId'),
		from: asString('from', DEV_INBOX_EMAIL),
		to: asList('to'),
		cc: asList('cc'),
		bcc: asList('bcc'),
		replyTo: asNullableString('replyTo'),
		subject: asString('subject', '(no subject)'),
		text: asNullableString('text'),
		html: asNullableString('html'),
		labels: asList('labels'),
		bodyText: body.trimStart(),
		attachments,
	}
}

const formatList = (items: string[], indent = '  '): string => {
	if (items.length === 0) return '[]'
	return `\n${items.map(item => `${indent}- ${item}`).join('\n')}`
}

const formatAttachmentLine = (a: StoredAttachment): string =>
	`id=${a.attachmentId}|filename=${a.filename}|contentType=${a.contentType}|size=${a.size}`

const formatMessage = (rec: MessageRecord): string => {
	const fm = [
		`sentAt: ${rec.sentAt}`,
		`provider: local-inbox`,
		`messageId: ${rec.messageId}`,
		`threadId: ${rec.threadId}`,
		`from: ${rec.from}`,
		`to: ${formatList(rec.to)}`,
		`cc: ${formatList(rec.cc)}`,
		`bcc: ${formatList(rec.bcc)}`,
		`replyTo: ${rec.replyTo === null ? 'null' : rec.replyTo}`,
		`subject: ${rec.subject}`,
		`text: ${rec.text === null ? 'null' : rec.text}`,
		`html: ${rec.html === null ? 'null' : rec.html}`,
		`labels: ${formatList(rec.labels)}`,
		`attachments: ${formatList(rec.attachments.map(formatAttachmentLine))}`,
	].join('\n')
	return `---\n${fm}\n---\n\n${rec.bodyText}\n`
}

// ── File I/O wrapped in Effect ──

const ensureDir = Effect.tryPromise({
	try: () => mkdir(INBOX_DIR, { recursive: true }),
	catch: e =>
		new EmailError({
			message: `local-inbox: cannot create ${INBOX_DIR}: ${e instanceof Error ? e.message : String(e)}`,
		}),
})

const listFiles = Effect.gen(function* () {
	yield* ensureDir
	const entries = yield* Effect.tryPromise({
		try: () => readdir(INBOX_DIR),
		catch: e =>
			new EmailError({
				message: `local-inbox: cannot read ${INBOX_DIR}: ${e instanceof Error ? e.message : String(e)}`,
			}),
	})
	return entries.filter(name => name.endsWith('.md')).sort()
})

const readRecord = (filename: string) =>
	Effect.tryPromise({
		try: async () => {
			const raw = await readFile(resolve(INBOX_DIR, filename), 'utf8')
			return { filename, record: parseFrontmatter(raw) }
		},
		catch: e =>
			new EmailError({
				message: `local-inbox: cannot read ${filename}: ${e instanceof Error ? e.message : String(e)}`,
			}),
	})

const readAllRecords = Effect.gen(function* () {
	const files = yield* listFiles
	const recs: { filename: string; record: MessageRecord }[] = []
	for (const f of files) {
		const r = yield* readRecord(f).pipe(
			Effect.catch(() =>
				Effect.succeed(
					null as { filename: string; record: MessageRecord } | null,
				),
			),
		)
		if (r) recs.push(r)
	}
	return recs
})

const writeRecord = (rec: MessageRecord, sentAt: Date) =>
	Effect.gen(function* () {
		const recipientForError = firstRecipient(rec.to)
		yield* ensureDir.pipe(
			Effect.mapError(
				e =>
					new EmailSendError({
						message: e.message,
						kind: 'unknown',
						recipient: recipientForError,
					}),
			),
		)
		const stamp = filenameStamp(sentAt)
		const recipient = slugify(recipientForError)
		const subject = slugify(rec.subject)
		const filename = `${stamp}__${recipient}__${subject}.md`
		const path = resolve(INBOX_DIR, filename)
		yield* Effect.tryPromise({
			try: () => writeFile(path, formatMessage(rec), 'utf8'),
			catch: e =>
				new EmailSendError({
					message: `local-inbox: cannot write ${filename}: ${e instanceof Error ? e.message : String(e)}`,
					kind: 'unknown',
					recipient: recipientForError,
				}),
		})
		yield* Effect.logInfo(`local-inbox: wrote ${filename}`)
		return { filename, path }
	})

// ── Mappers ──

// The HttpApi response encoder (Schema.Unknown) rejects object properties
// whose value is `undefined`. Only include optional fields when they carry
// a concrete value so the JSON shape stays encodable.
const toMessageItem = (rec: MessageRecord): ProviderMessageItem => {
	const preview = rec.bodyText.slice(0, 140)
	return {
		inboxId: DEV_INBOX_ID,
		threadId: rec.threadId,
		messageId: rec.messageId,
		from: rec.from,
		to: rec.to,
		timestamp: new Date(rec.sentAt),
		...(rec.cc.length > 0 && { cc: rec.cc }),
		...(rec.subject && { subject: rec.subject }),
		...(preview && { preview }),
	}
}

const toMessage = (rec: MessageRecord): ProviderMessage => {
	const body = rec.text ?? rec.bodyText
	return {
		...toMessageItem(rec),
		...(body && { text: body, extractedText: body }),
		...(rec.html && { html: rec.html }),
		attachments: rec.attachments.map(
			(a): ProviderAttachmentMeta => ({
				attachmentId: a.attachmentId,
				filename: a.filename,
				size: a.size,
				contentType: a.contentType,
			}),
		),
	}
}

const toThreadItem = (
	threadId: string,
	messages: MessageRecord[],
): ProviderThreadItem => {
	const sorted = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
	const last = sorted[sorted.length - 1]!
	return {
		inboxId: DEV_INBOX_ID,
		threadId,
		subject: last.subject || undefined,
		preview: last.bodyText.slice(0, 140) || undefined,
		senders: Array.from(new Set(sorted.map(m => m.from))),
		recipients: Array.from(new Set(sorted.flatMap(m => m.to))),
		lastMessageId: last.messageId,
		messageCount: sorted.length,
		timestamp: new Date(last.sentAt),
	}
}

const groupByThread = (
	records: MessageRecord[],
): Map<string, MessageRecord[]> => {
	const map = new Map<string, MessageRecord[]>()
	for (const r of records) {
		const list = map.get(r.threadId) ?? []
		list.push(r)
		map.set(r.threadId, list)
	}
	return map
}

// Persist outbound attachments to disk so `streamAttachment` can later
// serve them from the same filesystem that holds the .md frontmatter.
const persistAttachments = (
	messageId: string,
	attachments: readonly SendAttachmentInput[] | undefined,
) =>
	Effect.gen(function* () {
		if (!attachments || attachments.length === 0)
			return [] as StoredAttachment[]
		const dir = resolve(ATTACHMENTS_DIR, messageId)
		yield* Effect.tryPromise({
			try: () => mkdir(dir, { recursive: true }),
			catch: e =>
				new EmailSendError({
					message: `local-inbox: cannot create ${dir}: ${e instanceof Error ? e.message : String(e)}`,
					kind: 'unknown',
					recipient: 'unknown',
				}),
		})
		const stored: StoredAttachment[] = []
		for (const a of attachments) {
			const attachmentId = `att_local_${randomUUID()}`
			const bytes = Buffer.from(a.contentBase64, 'base64')
			const path = resolve(dir, attachmentId)
			yield* Effect.tryPromise({
				try: () => writeFile(path, bytes),
				catch: e =>
					new EmailSendError({
						message: `local-inbox: cannot write attachment ${a.filename}: ${e instanceof Error ? e.message : String(e)}`,
						kind: 'unknown',
						recipient: 'unknown',
					}),
			})
			stored.push({
				attachmentId,
				filename: a.filename,
				contentType: a.contentType,
				size: bytes.byteLength,
			})
		}
		return stored
	})

// ── Layer ──

export const LocalInboxProviderLive = Layer.effect(
	EmailProvider,
	Effect.gen(function* () {
		yield* Effect.logInfo(
			`local-inbox: dev email catcher active — files in ${INBOX_DIR}`,
		)

		const send = (
			_inboxId: string,
			params: SendParams,
		): Effect.Effect<SendResult, EmailSendError> =>
			Effect.gen(function* () {
				const sentAt = new Date()
				const messageId = `msg_local_${randomUUID()}`
				const threadId = `thr_local_${randomUUID()}`
				const recipients = Array.isArray(params.to) ? params.to : [params.to]
				const cc = params.cc
					? Array.isArray(params.cc)
						? params.cc
						: [params.cc]
					: []
				const bcc = params.bcc
					? Array.isArray(params.bcc)
						? params.bcc
						: [params.bcc]
					: []
				const replyTo = params.replyTo
					? Array.isArray(params.replyTo)
						? (params.replyTo[0] ?? null)
						: params.replyTo
					: null
				const stored = yield* persistAttachments(messageId, params.attachments)
				const rec: MessageRecord = {
					sentAt: sentAt.toISOString(),
					messageId,
					threadId,
					from: DEV_INBOX_EMAIL,
					to: recipients,
					cc,
					bcc,
					replyTo,
					subject: params.subject,
					text: params.text ?? null,
					html: params.html ?? null,
					labels: [],
					bodyText: params.text ?? params.html ?? '',
					attachments: stored,
				}
				yield* writeRecord(rec, sentAt)
				return { messageId, threadId }
			})

		const reply = (
			_inboxId: string,
			messageId: string,
			params: ReplyParams,
		): Effect.Effect<SendResult, EmailSendError> =>
			Effect.gen(function* () {
				// Find the original message to inherit its threadId.
				const all = yield* readAllRecords.pipe(
					Effect.catch(() =>
						Effect.succeed([] as { filename: string; record: MessageRecord }[]),
					),
				)
				const original = all.find(r => r.record.messageId === messageId)
				const threadId =
					original?.record.threadId ?? `thr_local_${randomUUID()}`
				const subject = original?.record.subject
					? `Re: ${original.record.subject.replace(/^Re:\s*/i, '')}`
					: 'Re: (local-inbox)'
				const sentAt = new Date()
				const newMessageId = `msg_local_${randomUUID()}`
				const recipients = params.to
					? Array.isArray(params.to)
						? params.to
						: [params.to]
					: (original?.record.to ?? [])
				const cc = params.cc
					? Array.isArray(params.cc)
						? params.cc
						: [params.cc]
					: []
				const bcc = params.bcc
					? Array.isArray(params.bcc)
						? params.bcc
						: [params.bcc]
					: []
				const stored = yield* persistAttachments(
					newMessageId,
					params.attachments,
				)
				const rec: MessageRecord = {
					sentAt: sentAt.toISOString(),
					messageId: newMessageId,
					threadId,
					from: DEV_INBOX_EMAIL,
					to: recipients,
					cc,
					bcc,
					replyTo: null,
					subject,
					text: params.text ?? null,
					html: params.html ?? null,
					labels: [],
					bodyText: params.text ?? params.html ?? '',
					attachments: stored,
				}
				yield* writeRecord(rec, sentAt)
				return { messageId: newMessageId, threadId }
			})

		const listThreads = (
			_inboxId: string,
			params?: ListParams,
		): Effect.Effect<ProviderThreadItem[], EmailError> =>
			Effect.gen(function* () {
				const all = yield* readAllRecords
				const grouped = groupByThread(all.map(r => r.record))
				const items = Array.from(grouped.entries())
					.map(([tid, msgs]) => toThreadItem(tid, msgs))
					.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
				const limit = params?.limit ?? items.length
				return items.slice(0, limit)
			})

		const getThread = (
			_inboxId: string,
			threadId: string,
		): Effect.Effect<ProviderThread, EmailError> =>
			Effect.gen(function* () {
				const all = yield* readAllRecords
				const matching = all
					.map(r => r.record)
					.filter(r => r.threadId === threadId)
				if (matching.length === 0) {
					return yield* Effect.fail(
						new EmailError({
							message: `local-inbox: thread ${threadId} not found`,
						}),
					)
				}
				const item = toThreadItem(threadId, matching)
				return {
					...item,
					messages: matching
						.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
						.map(toMessage),
				}
			})

		const listMessages = (
			_inboxId: string,
			params?: ListParams,
		): Effect.Effect<ProviderMessageItem[], EmailError> =>
			Effect.gen(function* () {
				const all = yield* readAllRecords
				const items = all
					.map(r => toMessageItem(r.record))
					.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
				const limit = params?.limit ?? items.length
				return items.slice(0, limit)
			})

		const getMessage = (
			_inboxId: string,
			messageId: string,
		): Effect.Effect<ProviderMessage, EmailError> =>
			Effect.gen(function* () {
				const all = yield* readAllRecords
				const found = all.find(r => r.record.messageId === messageId)
				if (!found) {
					return yield* Effect.fail(
						new EmailError({
							message: `local-inbox: message ${messageId} not found`,
						}),
					)
				}
				return toMessage(found.record)
			})

		const listInboxes = (): Effect.Effect<ProviderInbox[], EmailError> =>
			Effect.succeed([
				{
					inboxId: DEV_INBOX_ID,
					email: DEV_INBOX_EMAIL,
					displayName: DEV_INBOX_DISPLAY_NAME,
					createdAt: DEV_INBOX_CREATED_AT,
				},
			])

		const createInbox = (
			_params: CreateInboxParams,
		): Effect.Effect<ProviderInbox, EmailError> =>
			Effect.succeed({
				inboxId: DEV_INBOX_ID,
				email: DEV_INBOX_EMAIL,
				displayName: DEV_INBOX_DISPLAY_NAME,
				createdAt: DEV_INBOX_CREATED_AT,
			})

		const streamAttachment = (
			_inboxId: string,
			messageId: string,
			attachmentId: string,
		): Effect.Effect<ProviderAttachmentStream, EmailError> =>
			Effect.gen(function* () {
				const all = yield* readAllRecords
				const found = all.find(r => r.record.messageId === messageId)
				if (!found) {
					return yield* Effect.fail(
						new EmailError({
							message: `local-inbox: message ${messageId} not found`,
						}),
					)
				}
				const meta = found.record.attachments.find(
					a => a.attachmentId === attachmentId,
				)
				if (!meta) {
					return yield* Effect.fail(
						new EmailError({
							message: `local-inbox: attachment ${attachmentId} not found on ${messageId}`,
						}),
					)
				}
				const path = resolve(ATTACHMENTS_DIR, messageId, attachmentId)
				const size = yield* Effect.tryPromise({
					try: () => stat(path).then(s => s.size),
					catch: e =>
						new EmailError({
							message: `local-inbox: cannot stat ${path}: ${e instanceof Error ? e.message : String(e)}`,
						}),
				})
				const nodeStream = createReadStream(path)
				const webStream = Readable.toWeb(
					nodeStream,
				) as ReadableStream<Uint8Array>
				return {
					stream: webStream,
					contentType: meta.contentType,
					filename: meta.filename,
					size,
				}
			})

		const updateLabels = (
			_inboxId: string,
			messageId: string,
			add: string[],
			remove: string[],
		): Effect.Effect<void, EmailError> =>
			Effect.gen(function* () {
				const all = yield* readAllRecords
				const found = all.find(r => r.record.messageId === messageId)
				if (!found) {
					return yield* Effect.fail(
						new EmailError({
							message: `local-inbox: message ${messageId} not found for label update`,
						}),
					)
				}
				const next = new Set(found.record.labels)
				for (const l of add) next.add(l)
				for (const l of remove) next.delete(l)
				const updated: MessageRecord = {
					...found.record,
					labels: Array.from(next),
				}
				yield* Effect.tryPromise({
					try: () =>
						writeFile(
							resolve(INBOX_DIR, found.filename),
							formatMessage(updated),
							'utf8',
						),
					catch: e =>
						new EmailError({
							message: `local-inbox: cannot rewrite ${found.filename}: ${e instanceof Error ? e.message : String(e)}`,
						}),
				})
				yield* Effect.logInfo(
					`local-inbox: updated labels on ${found.filename}`,
				)
			})

		// ── Drafts ──

		const ensureDraftsDir = Effect.tryPromise({
			try: () => mkdir(DRAFTS_DIR, { recursive: true }),
			catch: e =>
				new EmailError({
					message: `local-inbox: cannot create ${DRAFTS_DIR}: ${e instanceof Error ? e.message : String(e)}`,
				}),
		})

		const draftFilename = (draftId: string) => `${draftId}.md`
		const draftPath = (draftId: string) =>
			resolve(DRAFTS_DIR, draftFilename(draftId))

		const writeDraftFile = (draft: ProviderDraft) =>
			Effect.gen(function* () {
				yield* ensureDraftsDir
				const to = draft.to ?? []
				const cc = draft.cc ?? []
				const bcc = draft.bcc ?? []
				const fm = [
					`draftId: ${draft.draftId}`,
					`inboxId: ${draft.inboxId}`,
					`to: ${formatList(to)}`,
					`cc: ${formatList(cc)}`,
					`bcc: ${formatList(bcc)}`,
					`subject: ${draft.subject ?? ''}`,
					`text: ${draft.text === undefined ? 'null' : draft.text}`,
					`html: ${draft.html === undefined ? 'null' : draft.html}`,
					...(draft.clientId ? [`clientId: ${draft.clientId}`] : []),
					...(draft.inReplyTo ? [`inReplyTo: ${draft.inReplyTo}`] : []),
					`updatedAt: ${draft.updatedAt.toISOString()}`,
					`createdAt: ${draft.createdAt.toISOString()}`,
				].join('\n')
				const body = draft.text ?? draft.html ?? ''
				const content = `---\n${fm}\n---\n\n${body}\n`
				yield* Effect.tryPromise({
					try: () => writeFile(draftPath(draft.draftId), content, 'utf8'),
					catch: e =>
						new EmailError({
							message: `local-inbox: cannot write draft: ${e instanceof Error ? e.message : String(e)}`,
						}),
				})
			})

		const readDraftFile = (draftId: string) =>
			Effect.tryPromise({
				try: async () => {
					const raw = await readFile(draftPath(draftId), 'utf8')
					const match = FRONTMATTER_RE.exec(raw)
					if (!match) throw new Error('missing frontmatter')
					const fmText = match[1] ?? ''
					const body = (match[2] ?? '').trimStart()
					const fields: Record<string, string | string[]> = {}
					const lines = fmText.split('\n')
					let currentList: { key: string; items: string[] } | null = null
					for (const line of lines) {
						if (line.startsWith('  - ') && currentList) {
							currentList.items.push(line.slice(4).trim())
							continue
						}
						if (currentList) {
							fields[currentList.key] = currentList.items
							currentList = null
						}
						const colon = line.indexOf(':')
						if (colon === -1) continue
						const key = line.slice(0, colon).trim()
						const value = line.slice(colon + 1).trim()
						if (value === '') {
							currentList = { key, items: [] }
						} else if (value === '[]') {
							fields[key] = []
						} else {
							fields[key] = value
						}
					}
					if (currentList) fields[currentList.key] = currentList.items
					const str = (k: string) => {
						const v = fields[k]
						return typeof v === 'string' && v !== 'null' ? v : undefined
					}
					const list = (k: string) => {
						const v = fields[k]
						return Array.isArray(v) && v.length > 0 ? v : undefined
					}
					return {
						draftId: str('draftId') ?? draftId,
						inboxId: str('inboxId') ?? DEV_INBOX_ID,
						clientId: str('clientId'),
						to: list('to'),
						cc: list('cc'),
						bcc: list('bcc'),
						subject: str('subject'),
						preview: body.slice(0, 140) || undefined,
						text: str('text') ?? (body || undefined),
						html: str('html'),
						inReplyTo: str('inReplyTo'),
						updatedAt: new Date(str('updatedAt') ?? Date.now()),
						createdAt: new Date(str('createdAt') ?? Date.now()),
					} satisfies ProviderDraft
				},
				catch: e =>
					new EmailError({
						message: `local-inbox: cannot read draft ${draftId}: ${e instanceof Error ? e.message : String(e)}`,
					}),
			})

		const coerceList = (
			v: string | string[] | undefined,
		): string[] | undefined => {
			if (v === undefined) return undefined
			return Array.isArray(v) ? v : [v]
		}

		const createDraft = (
			_inboxId: string,
			params: CreateDraftParams,
		): Effect.Effect<ProviderDraft, EmailError> =>
			Effect.gen(function* () {
				const now = new Date()
				const draft: ProviderDraft = {
					draftId: `draft_local_${randomUUID()}`,
					inboxId: DEV_INBOX_ID,
					clientId: params.clientId,
					to: coerceList(params.to),
					cc: coerceList(params.cc),
					bcc: coerceList(params.bcc),
					subject: params.subject,
					text: params.text,
					html: params.html,
					inReplyTo: params.inReplyTo,
					updatedAt: now,
					createdAt: now,
				}
				yield* writeDraftFile(draft)
				yield* Effect.logInfo(`local-inbox: created draft ${draft.draftId}`)
				return draft
			})

		const updateDraft = (
			_inboxId: string,
			draftId: string,
			params: UpdateDraftParams,
		): Effect.Effect<ProviderDraft, EmailError> =>
			Effect.gen(function* () {
				const existing = yield* readDraftFile(draftId)
				const updated: ProviderDraft = {
					...existing,
					to: params.to !== undefined ? coerceList(params.to) : existing.to,
					cc: params.cc !== undefined ? coerceList(params.cc) : existing.cc,
					bcc: params.bcc !== undefined ? coerceList(params.bcc) : existing.bcc,
					subject: params.subject ?? existing.subject,
					text: params.text ?? existing.text,
					html: params.html ?? existing.html,
					updatedAt: new Date(),
				}
				yield* writeDraftFile(updated)
				return updated
			})

		const deleteDraft = (
			_inboxId: string,
			draftId: string,
		): Effect.Effect<void, EmailError> =>
			Effect.tryPromise({
				try: () => unlink(draftPath(draftId)),
				catch: e =>
					new EmailError({
						message: `local-inbox: cannot delete draft ${draftId}: ${e instanceof Error ? e.message : String(e)}`,
					}),
			}).pipe(Effect.asVoid)

		const sendDraft = (
			_inboxId: string,
			draftId: string,
		): Effect.Effect<SendResult, EmailSendError> =>
			Effect.gen(function* () {
				const draft = yield* readDraftFile(draftId).pipe(
					Effect.mapError(
						e =>
							new EmailSendError({
								message: e.message,
								kind: 'unknown',
								recipient: null,
							}),
					),
				)
				const sentAt = new Date()
				const messageId = `msg_local_${randomUUID()}`
				const threadId = `thr_local_${randomUUID()}`
				const rec: MessageRecord = {
					sentAt: sentAt.toISOString(),
					messageId,
					threadId,
					from: DEV_INBOX_EMAIL,
					to: draft.to ?? [],
					cc: draft.cc ?? [],
					bcc: draft.bcc ?? [],
					replyTo: null,
					subject: draft.subject ?? '(no subject)',
					text: draft.text ?? null,
					html: draft.html ?? null,
					labels: [],
					bodyText: draft.text ?? draft.html ?? '',
					attachments: [],
				}
				yield* writeRecord(rec, sentAt)
				yield* Effect.tryPromise({
					try: () => unlink(draftPath(draftId)),
					catch: () =>
						new EmailSendError({
							message: `local-inbox: cannot delete sent draft ${draftId}`,
							kind: 'unknown',
							recipient: null,
						}),
				})
				yield* Effect.logInfo(
					`local-inbox: sent draft ${draftId} as ${messageId}`,
				)
				return { messageId, threadId }
			})

		const listDrafts = (
			_inboxId: string,
			_params?: ListParams,
		): Effect.Effect<ProviderDraftItem[], EmailError> =>
			Effect.gen(function* () {
				yield* ensureDraftsDir
				const entries = yield* Effect.tryPromise({
					try: () => readdir(DRAFTS_DIR),
					catch: e =>
						new EmailError({
							message: `local-inbox: cannot read drafts dir: ${e instanceof Error ? e.message : String(e)}`,
						}),
				})
				const mdFiles = entries.filter(n => n.endsWith('.md'))
				const drafts: ProviderDraftItem[] = []
				for (const f of mdFiles) {
					const id = f.replace(/\.md$/, '')
					const d = yield* readDraftFile(id).pipe(
						Effect.catch(() => Effect.succeed(null as ProviderDraft | null)),
					)
					if (d) drafts.push(d)
				}
				return drafts.sort(
					(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
				)
			})

		const getDraft = (
			_inboxId: string,
			draftId: string,
		): Effect.Effect<ProviderDraft, EmailError> => readDraftFile(draftId)

		return {
			send,
			reply,
			listThreads,
			getThread,
			listMessages,
			getMessage,
			listInboxes,
			createInbox,
			streamAttachment,
			updateLabels,
			createDraft,
			updateDraft,
			deleteDraft,
			sendDraft,
			listDrafts,
			getDraft,
		} as const
	}),
)
