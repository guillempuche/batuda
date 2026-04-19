import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { DateTime, Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { BadRequest } from '@engranatge/controllers'

import {
	compressEmailImage,
	isCompressibleImage,
	MAX_BYTES,
} from './email-asset-compression.js'
import { StorageProvider } from './storage-provider.js'

// Durable, StorageProvider-backed staging. Uploaded bytes live in object
// storage under "email/staging/<inboxId>/<stagingId>"; a shadow row in
// email_attachment_staging tracks each entry so we can sweep on draft
// delete, send, or TTL. Survives server restarts so in-progress drafts
// keep their attachments.

const TTL_MS = 60 * 60 * 1000 // 1 hour — durable storage is cheap
const MAX_FILENAME_LEN = 255
const STORAGE_PREFIX = 'email/staging'
const URL_TTL_SEC = 600 // 10min — editor canvas inline-preview URL

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export interface StageInput {
	readonly inboxId: string
	readonly bytes: Uint8Array
	readonly filename: string
	readonly contentType: string
	readonly isInline: boolean
	readonly draftId?: string | undefined
}

export interface StagingRef {
	readonly stagingId: string
	readonly inline: boolean
	readonly cid?: string | undefined
	readonly filename?: string | undefined
}

export interface StagedAttachmentPublic {
	readonly stagingId: string
	readonly filename: string
	readonly contentType: string
	readonly size: number
	readonly isInline: boolean
	readonly previewUrl?: string | undefined
}

// Fully hydrated staging suitable for both the provider (base64 bytes +
// optional Content-ID) and the renderer (stagingId → cid lookup). The
// service returns one of these per ref in `resolve`, and the caller can
// map to either shape without re-querying.
export interface ResolvedStaging {
	readonly stagingId: string
	readonly inline: boolean
	readonly cid: string | null
	readonly filename: string
	readonly contentType: string
	readonly contentBase64: string
}

// Rows returned from the DB mirror snake_case→camelCase via the Pg client's
// transformResultNames. Declaring the shape explicitly keeps JSON queries honest.
interface StagingRow {
	readonly stagingId: string
	readonly inboxId: string
	readonly draftId: string | null
	readonly storageKey: string
	readonly filename: string
	readonly contentType: string
	readonly sizeBytes: number
	readonly isInline: boolean
	readonly cid: string | null
	readonly sentAt: Date | null
}

// ────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────

export class EmailAttachmentStaging extends ServiceMap.Service<EmailAttachmentStaging>()(
	'EmailAttachmentStaging',
	{
		make: Effect.gen(function* () {
			const storage = yield* StorageProvider
			const sql = yield* SqlClient.SqlClient

			// ── stage ──
			const stage = (
				input: StageInput,
			): Effect.Effect<StagedAttachmentPublic, BadRequest> =>
				Effect.gen(function* () {
					if (input.bytes.byteLength === 0) {
						return yield* new BadRequest({
							message: 'Cannot stage empty attachment',
						})
					}
					if (input.bytes.byteLength > MAX_BYTES) {
						return yield* new BadRequest({
							message: `Attachment ${input.filename} exceeds ${MAX_BYTES} byte limit`,
						})
					}

					// Compression runs only for the email-staging call path. Other
					// StorageProvider consumers (recordings, research blobs) never
					// hit this service — their bytes stay verbatim.
					const compressed = isCompressibleImage(input.contentType)
						? yield* compressEmailImage(input.bytes, input.contentType)
						: {
								bytes: input.bytes,
								contentType: input.contentType,
								width: undefined,
								height: undefined,
							}

					const stagingId = `stg_${randomUUID()}`
					const storageKey = `${STORAGE_PREFIX}/${input.inboxId}/${stagingId}`
					const safeFilename = sanitizeFilename(input.filename)
					const now = DateTime.nowUnsafe()
					const expiresAt = DateTime.addDuration(now, `${TTL_MS} millis`)

					// Put first, then insert. If the DB insert fails the object is
					// orphaned briefly; the compensating delete below ensures it's
					// gone before we surface the error. The opposite ordering would
					// leave an unreferenced row pointing at a missing object — a
					// worse failure mode.
					yield* storage
						.put({
							key: storageKey,
							body: compressed.bytes,
							contentType: compressed.contentType,
						})
						.pipe(
							Effect.mapError(
								err =>
									new BadRequest({
										message: `Storage upload failed: ${err.message}`,
									}),
							),
						)

					const insertResult = yield* sql`
						INSERT INTO email_attachment_staging (
							staging_id, inbox_id, draft_id, storage_key,
							filename, content_type, size_bytes, is_inline,
							expires_at
						) VALUES (
							${stagingId}, ${input.inboxId}, ${input.draftId ?? null}, ${storageKey},
							${safeFilename}, ${compressed.contentType}, ${compressed.bytes.byteLength}, ${input.isInline},
							${DateTime.toDate(expiresAt)}
						)
					`.pipe(
						Effect.mapError(
							() =>
								new BadRequest({ message: 'Failed to persist staging row' }),
						),
						Effect.tapError(() =>
							storage.delete(storageKey).pipe(Effect.ignore),
						),
					)
					void insertResult

					const previewUrl = yield* storage
						.signedUrl(storageKey, URL_TTL_SEC)
						.pipe(
							Effect.catch(() => Effect.succeed<string | undefined>(undefined)),
						)

					return {
						stagingId,
						filename: safeFilename,
						contentType: compressed.contentType,
						size: compressed.bytes.byteLength,
						isInline: input.isInline,
						...(previewUrl !== undefined ? { previewUrl } : {}),
					} satisfies StagedAttachmentPublic
				})

			// ── resolve ── called at send time. Fetches bytes, assigns CIDs
			// when inline. The returned shape is fat enough for both the
			// provider (bytes + Content-ID) and the renderer (stagingId →
			// cid) so the caller doesn't need a second query.
			const resolve = (
				inboxId: string,
				refs: ReadonlyArray<StagingRef>,
			): Effect.Effect<readonly ResolvedStaging[], BadRequest> =>
				Effect.gen(function* () {
					if (refs.length === 0) return []

					const ids = [...new Set(refs.map(r => r.stagingId))]
					const rows = yield* sql<StagingRow>`
						SELECT staging_id, inbox_id, draft_id, storage_key,
						       filename, content_type, size_bytes, is_inline, cid, sent_at
						FROM email_attachment_staging
						WHERE staging_id IN ${sql.in(ids)}
					`.pipe(
						Effect.mapError(
							() => new BadRequest({ message: 'Failed to read staging rows' }),
						),
					)

					const byId = new Map<string, StagingRow>()
					for (const row of rows) byId.set(row.stagingId, row)

					const out: ResolvedStaging[] = []
					for (const ref of refs) {
						const row = byId.get(ref.stagingId)
						if (!row) {
							return yield* new BadRequest({
								message: `Staging id ${ref.stagingId} not found or expired`,
							})
						}
						if (row.inboxId !== inboxId) {
							return yield* new BadRequest({
								message: `Staging id ${ref.stagingId} belongs to a different inbox`,
							})
						}
						const bytes = yield* storage.get(row.storageKey).pipe(
							Effect.mapError(
								err =>
									new BadRequest({
										message: `Storage fetch failed for ${ref.stagingId}: ${err.message}`,
									}),
							),
						)
						const inline = ref.inline
						const cid = inline
							? (ref.cid ?? row.cid ?? generateCid())
							: (ref.cid ?? row.cid)
						if (inline && row.cid !== cid) {
							yield* sql`
								UPDATE email_attachment_staging
								SET cid = ${cid}
								WHERE staging_id = ${row.stagingId}
							`.pipe(Effect.ignore)
						}
						out.push({
							stagingId: row.stagingId,
							inline,
							cid: cid ?? null,
							filename: ref.filename ?? row.filename,
							contentType: row.contentType,
							contentBase64: Buffer.from(bytes).toString('base64'),
						})
					}
					return out
				})

			// ── discard ── explicit deletion: node-remove, chip-remove.
			const discard = (
				inboxId: string,
				stagingId: string,
			): Effect.Effect<void, BadRequest> =>
				Effect.gen(function* () {
					const rows = yield* sql<{
						readonly storageKey: string
						readonly inboxId: string
					}>`
						SELECT storage_key, inbox_id
						FROM email_attachment_staging
						WHERE staging_id = ${stagingId}
					`.pipe(
						Effect.mapError(
							() => new BadRequest({ message: 'Failed to read staging row' }),
						),
					)
					const row = rows[0]
					if (!row) return // idempotent
					if (row.inboxId !== inboxId) {
						return yield* new BadRequest({
							message: `Cannot discard staging id belonging to a different inbox`,
						})
					}
					yield* sql`
						DELETE FROM email_attachment_staging WHERE staging_id = ${stagingId}
					`.pipe(Effect.ignore)
					yield* storage.delete(row.storageKey).pipe(Effect.ignore)
				})

			// ── sweepForDraft ── draft deleted → remove associated stagings.
			const sweepForDraft = (
				draftId: string,
			): Effect.Effect<void, BadRequest> =>
				Effect.gen(function* () {
					const rows = yield* sql<{
						readonly stagingId: string
						readonly storageKey: string
					}>`
						SELECT staging_id, storage_key
						FROM email_attachment_staging
						WHERE draft_id = ${draftId} AND sent_at IS NULL
					`.pipe(
						Effect.mapError(
							() =>
								new BadRequest({ message: 'Failed to read draft stagings' }),
						),
					)
					if (rows.length === 0) return
					for (const row of rows) {
						yield* storage.delete(row.storageKey).pipe(Effect.ignore)
					}
					yield* sql`
						DELETE FROM email_attachment_staging
						WHERE staging_id IN ${sql.in(rows.map(r => r.stagingId))}
					`.pipe(Effect.ignore)
				})

			// ── markSentAndCleanup ── provider acked the send; purge.
			const markSentAndCleanup = (
				stagingIds: ReadonlyArray<string>,
			): Effect.Effect<void, BadRequest> =>
				Effect.gen(function* () {
					if (stagingIds.length === 0) return
					const rows = yield* sql<{ readonly storageKey: string }>`
						SELECT storage_key FROM email_attachment_staging
						WHERE staging_id IN ${sql.in(stagingIds)}
					`.pipe(
						Effect.mapError(
							() => new BadRequest({ message: 'Failed to read sent stagings' }),
						),
					)
					for (const row of rows) {
						yield* storage.delete(row.storageKey).pipe(Effect.ignore)
					}
					yield* sql`
						DELETE FROM email_attachment_staging
						WHERE staging_id IN ${sql.in([...stagingIds])}
					`.pipe(Effect.ignore)
				})

			// ── attachToDraft ── wire a staging to a draft so sweep tracks it.
			const attachToDraft = (
				stagingId: string,
				draftId: string,
			): Effect.Effect<void, BadRequest> =>
				sql`
					UPDATE email_attachment_staging
					SET draft_id = ${draftId}
					WHERE staging_id = ${stagingId}
				`.pipe(
					Effect.asVoid,
					Effect.mapError(
						() =>
							new BadRequest({ message: 'Failed to attach staging to draft' }),
					),
				)

			// ── sweepExpired ── TTL garbage collection. Only touches orphaned
			// (draft_id IS NULL) or post-send rows whose expires_at has passed.
			// Active drafts hold their stagings; they expire on draft-delete.
			const sweepExpired = (): Effect.Effect<number, BadRequest> =>
				Effect.gen(function* () {
					const nowDate = DateTime.toDate(DateTime.nowUnsafe())
					const rows = yield* sql<{
						readonly stagingId: string
						readonly storageKey: string
					}>`
						SELECT staging_id, storage_key
						FROM email_attachment_staging
						WHERE expires_at < ${nowDate}
						  AND sent_at IS NULL
						  AND draft_id IS NULL
						LIMIT 500
					`.pipe(
						Effect.mapError(
							() =>
								new BadRequest({ message: 'Failed to read expired stagings' }),
						),
					)
					for (const row of rows) {
						yield* storage.delete(row.storageKey).pipe(Effect.ignore)
					}
					if (rows.length > 0) {
						yield* sql`
							DELETE FROM email_attachment_staging
							WHERE staging_id IN ${sql.in(rows.map(r => r.stagingId))}
						`.pipe(Effect.ignore)
					}
					return rows.length
				})

			// ── signedPreviewUrl ── short-lived URL for the editor canvas.
			const signedPreviewUrl = (
				inboxId: string,
				stagingId: string,
			): Effect.Effect<string | null, BadRequest> =>
				Effect.gen(function* () {
					const rows = yield* sql<{
						readonly storageKey: string
						readonly inboxId: string
					}>`
						SELECT storage_key, inbox_id
						FROM email_attachment_staging
						WHERE staging_id = ${stagingId}
					`.pipe(
						Effect.mapError(
							() => new BadRequest({ message: 'Failed to read staging row' }),
						),
					)
					const row = rows[0]
					if (!row) return null
					if (row.inboxId !== inboxId) {
						return yield* new BadRequest({
							message: 'Cannot preview staging from a different inbox',
						})
					}
					return yield* storage.signedUrl(row.storageKey, URL_TTL_SEC).pipe(
						Effect.mapError(
							err =>
								new BadRequest({
									message: `Signed URL failed: ${err.message}`,
								}),
						),
					)
				})

			return {
				stage,
				resolve,
				discard,
				sweepForDraft,
				markSentAndCleanup,
				attachToDraft,
				sweepExpired,
				signedPreviewUrl,
			} as const
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

const sanitizeFilename = (raw: string): string => {
	// Basename only — defends against agent/user-supplied "../../etc/passwd".
	const base = path.basename(raw.replace(/\\/g, '/'))
	// Strip control chars, normalize whitespace.
	const cleaned = base.replace(/\p{Cc}/gu, '').trim()
	const name = cleaned.length === 0 ? 'attachment' : cleaned
	if (name.length <= MAX_FILENAME_LEN) return name
	const ext = path.extname(name)
	const stem = name.slice(0, name.length - ext.length)
	return stem.slice(0, MAX_FILENAME_LEN - ext.length) + ext
}

const generateCid = (): string => {
	// RFC 2045 Content-ID — left half of an addr-spec. Keep to hostname-less
	// form so quoted-reply re-attachment doesn't need to match a bracketed
	// Message-ID; bare uuid is enough for MIME resolution within one message.
	return `stg-${randomUUID()}`
}
