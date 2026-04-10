import { randomUUID } from 'node:crypto'

import { Effect, Layer, ServiceMap } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

import { BadRequest, Conflict, NotFound } from '@engranatge/controllers'

import { StorageProvider } from './storage-provider.js'
import { WebhookService } from './webhooks.js'

export interface IngestParams {
	readonly audio: Uint8Array
	readonly mimeType: string
	readonly byteSize: number
	readonly durationSec?: number | undefined
	readonly companyId?: string | undefined
	readonly contactId?: string | undefined
	readonly interactionId?: string | undefined
}

export interface IngestResult {
	readonly recordingId: string
	readonly interactionId: string
}

// Tiny mime → extension map for the storage key. We deliberately don't pull
// in `mime-types` for this — five lookups isn't worth a dep, and the storage
// key extension is purely cosmetic (the mime_type column is the source of
// truth at read time).
const extForMimeType = (mimeType: string): string => {
	const map: Record<string, string> = {
		'audio/mpeg': 'mp3',
		'audio/mp3': 'mp3',
		'audio/mp4': 'm4a',
		'audio/x-m4a': 'm4a',
		'audio/wav': 'wav',
		'audio/x-wav': 'wav',
		'audio/webm': 'webm',
		'audio/ogg': 'ogg',
	}
	return map[mimeType.toLowerCase()] ?? 'bin'
}

export class RecordingService extends ServiceMap.Service<RecordingService>()(
	'RecordingService',
	{
		make: Effect.gen(function* () {
			const storage = yield* StorageProvider
			const sql = yield* SqlClient.SqlClient
			const webhooks = yield* WebhookService

			const ingest = (params: IngestParams) =>
				Effect.gen(function* () {
					if (!params.interactionId && !params.companyId) {
						return yield* new BadRequest({
							message: 'Either interactionId or companyId must be provided',
						})
					}

					// Everything DB-side runs in a single transaction. Storage put
					// happens **inside** the tx so a network failure rolls the row
					// back — no orphaned DB row, no orphaned object (the put never
					// completed). The opposite ordering would risk an orphaned
					// object on commit failure, which is a much smaller window and
					// acceptable for this iteration; a future cleanup cron will
					// catch any leftovers.
					const result = yield* sql.withTransaction(
						Effect.gen(function* () {
							let interactionId: string
							let companyId: string

							if (params.interactionId) {
								// Attach to an existing call interaction.
								// PgClient.transformResultNames converts snake_case
								// columns to camelCase, so the row shape here is
								// camelCase even though the SELECT lists snake_case.
								const rows = yield* sql<{
									id: string
									companyId: string
									channel: string
								}>`
									SELECT id, company_id, channel
									FROM interactions
									WHERE id = ${params.interactionId}
									LIMIT 1
								`
								const row = rows[0]
								if (!row) {
									return yield* new NotFound({
										entity: 'Interaction',
										id: params.interactionId,
									})
								}
								if (row.channel !== 'call') {
									return yield* new Conflict({
										message: `Interaction ${params.interactionId} is channel='${row.channel}', expected 'call'`,
									})
								}
								if (params.companyId && params.companyId !== row.companyId) {
									return yield* new Conflict({
										message: `companyId mismatch: provided ${params.companyId}, interaction belongs to ${row.companyId}`,
									})
								}
								// UNIQUE constraint on call_recordings.interaction_id
								// would catch this on insert, but checking up-front
								// gives us a clean Conflict error instead of an opaque
								// SqlError.
								const existing = yield* sql<{ id: string }>`
									SELECT id FROM call_recordings
									WHERE interaction_id = ${row.id}
									  AND deleted_at IS NULL
									LIMIT 1
								`
								if (existing.length > 0) {
									return yield* new Conflict({
										message: `Interaction ${row.id} already has a recording attached`,
									})
								}

								interactionId = row.id
								companyId = row.companyId
							} else {
								// No interactionId → create a fresh call interaction
								// for this recording. companyId is required (validated
								// above).
								companyId = params.companyId as string
								const inserted = yield* sql<{ id: string }>`
									INSERT INTO interactions ${sql.insert({
										companyId,
										contactId: params.contactId ?? null,
										date: new Date(),
										channel: 'call',
										direction: 'outbound',
										type: 'call',
										summary: 'Call recording',
									})}
									RETURNING id
								`
								interactionId = inserted[0]!.id
							}

							const ext = extForMimeType(params.mimeType)
							const storageKey = `recordings/${companyId}/${randomUUID()}.${ext}`

							const recordingInsert = yield* sql<{ id: string }>`
								INSERT INTO call_recordings ${sql.insert({
									interactionId,
									storageKey,
									mimeType: params.mimeType,
									byteSize: params.byteSize,
									durationSec: params.durationSec ?? null,
								})}
								RETURNING id
							`
							const recordingId = recordingInsert[0]!.id

							// Storage put — failure rolls back the tx, leaving zero
							// state behind in DB or storage.
							yield* storage.put({
								key: storageKey,
								body: params.audio,
								contentType: params.mimeType,
							})

							yield* sql`
								UPDATE companies
								SET last_contacted_at = now(), updated_at = now()
								WHERE id = ${companyId}
							`

							return { recordingId, interactionId, companyId }
						}),
					)

					// Webhook fires only after the tx commits — never on rollback.
					yield* webhooks.fire('recording.uploaded', {
						recordingId: result.recordingId,
						interactionId: result.interactionId,
						companyId: result.companyId,
					})

					yield* Effect.logInfo('Call recording ingested').pipe(
						Effect.annotateLogs({
							event: 'recording.uploaded',
							recordingId: result.recordingId,
							interactionId: result.interactionId,
							companyId: result.companyId,
						}),
					)

					return {
						recordingId: result.recordingId,
						interactionId: result.interactionId,
					} satisfies IngestResult
				})

			const listForCompany = (companyId: string, limit = 50, offset = 0) =>
				sql`
					SELECT
						cr.id,
						cr.interaction_id,
						cr.storage_key,
						cr.mime_type,
						cr.byte_size,
						cr.duration_sec,
						cr.transcript_status,
						cr.created_at,
						cr.updated_at,
						i.date AS interaction_date,
						i.contact_id,
						i.summary
					FROM call_recordings cr
					INNER JOIN interactions i ON i.id = cr.interaction_id
					WHERE i.company_id = ${companyId}
					  AND cr.deleted_at IS NULL
					ORDER BY i.date DESC
					LIMIT ${limit}
					OFFSET ${offset}
				`

			const getById = (recordingId: string) =>
				Effect.gen(function* () {
					const rows = yield* sql`
						SELECT
							cr.*,
							i.company_id,
							i.contact_id,
							i.date AS interaction_date,
							i.summary
						FROM call_recordings cr
						INNER JOIN interactions i ON i.id = cr.interaction_id
						WHERE cr.id = ${recordingId}
						  AND cr.deleted_at IS NULL
						LIMIT 1
					`
					if (rows.length === 0) {
						return yield* new NotFound({
							entity: 'CallRecording',
							id: recordingId,
						})
					}
					return rows[0]
				})

			const getPlaybackUrl = (recordingId: string) =>
				Effect.gen(function* () {
					const rows = yield* sql<{ storageKey: string }>`
						SELECT storage_key FROM call_recordings
						WHERE id = ${recordingId}
						  AND deleted_at IS NULL
						LIMIT 1
					`
					const row = rows[0]
					if (!row) {
						return yield* new NotFound({
							entity: 'CallRecording',
							id: recordingId,
						})
					}
					// 10 minutes is enough for the UI to start playback while
					// keeping the leak window small if a URL is logged or
					// shared accidentally.
					const expiresInSeconds = 600
					const url = yield* storage.signedUrl(row.storageKey, expiresInSeconds)
					return {
						url,
						expiresAt: new Date(
							Date.now() + expiresInSeconds * 1000,
						).toISOString(),
					}
				})

			const softDelete = (recordingId: string) =>
				Effect.gen(function* () {
					const rows = yield* sql<{ storageKey: string }>`
						SELECT storage_key FROM call_recordings
						WHERE id = ${recordingId}
						  AND deleted_at IS NULL
						LIMIT 1
					`
					const row = rows[0]
					if (!row) {
						return yield* new NotFound({
							entity: 'CallRecording',
							id: recordingId,
						})
					}
					yield* sql`
						UPDATE call_recordings
						SET deleted_at = now(), updated_at = now()
						WHERE id = ${recordingId}
					`
					// Best-effort storage delete after the DB row is marked
					// deleted. If this fails, we still consider the recording
					// deleted from the user's perspective; an orphaned object
					// will be caught by a future cleanup cron. The reverse
					// order would risk losing the storage_key reference if the
					// DB write failed mid-flight.
					yield* storage.delete(row.storageKey).pipe(
						Effect.catchTag('StorageError', err =>
							Effect.logError(
								'Storage delete failed for soft-deleted recording',
							).pipe(
								Effect.annotateLogs({
									event: 'recording.storage_delete_failed',
									recordingId,
									storageKey: row.storageKey,
									error: err.message,
								}),
							),
						),
					)
				})

			return {
				ingest,
				listForCompany,
				getById,
				getPlaybackUrl,
				softDelete,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
