import { Effect, Stream } from 'effect'
import { HttpServerResponse, Multipart } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { BadRequest, ForjaApi } from '@engranatge/controllers'

import { RecordingService } from '../services/recordings'

// Accumulator built up as we walk the multipart stream. We process parts
// sequentially so a File part's `contentEffect` runs while the underlying
// stream is still positioned on its body — collecting all parts up-front
// and then trying to read content later would consume nothing.
interface UploadFields {
	audio: Uint8Array | undefined
	mimeType: string | undefined
	companyId: string | undefined
	interactionId: string | undefined
	contactId: string | undefined
	durationSec: number | undefined
}

const emptyUpload = (): UploadFields => ({
	audio: undefined,
	mimeType: undefined,
	companyId: undefined,
	interactionId: undefined,
	contactId: undefined,
	durationSec: undefined,
})

export const RecordingsLive = HttpApiBuilder.group(
	ForjaApi,
	'recordings',
	handlers =>
		Effect.gen(function* () {
			const svc = yield* RecordingService

			return handlers
				.handleRaw(
					'upload',
					Effect.fnUntraced(function* ({ request }) {
						const upload = emptyUpload()

						// Walk the multipart stream incrementally. Field parts
						// are plain key/value strings; the audio File part is
						// loaded into memory via contentEffect (small enough
						// for typical call recordings — a few hundred MB at
						// the very upper end). Future iteration could stream
						// directly to S3, but the simpler path lets the tx
						// rollback also undo any "partial" upload because
						// nothing has touched S3 until we call storage.put.
						yield* request.multipartStream.pipe(
							Stream.runForEach(part =>
								Effect.gen(function* () {
									if (Multipart.isField(part)) {
										switch (part.key) {
											case 'companyId':
												upload.companyId = part.value
												break
											case 'interactionId':
												upload.interactionId = part.value
												break
											case 'contactId':
												upload.contactId = part.value
												break
											case 'durationSec': {
												const n = Number(part.value)
												if (Number.isFinite(n)) {
													upload.durationSec = n
												}
												break
											}
										}
									} else if (Multipart.isFile(part) && part.key === 'audio') {
										upload.audio = yield* part.contentEffect
										upload.mimeType = part.contentType
									}
								}),
							),
							Effect.orDie,
						)

						if (!upload.audio || !upload.mimeType) {
							return HttpServerResponse.jsonUnsafe(
								{
									_tag: 'BadRequest',
									message: 'Missing audio file in multipart upload',
								},
								{ status: 400 },
							)
						}

						const result = yield* svc
							.ingest({
								audio: upload.audio,
								mimeType: upload.mimeType,
								byteSize: upload.audio.byteLength,
								...(upload.durationSec !== undefined && {
									durationSec: upload.durationSec,
								}),
								...(upload.companyId !== undefined && {
									companyId: upload.companyId,
								}),
								...(upload.contactId !== undefined && {
									contactId: upload.contactId,
								}),
								...(upload.interactionId !== undefined && {
									interactionId: upload.interactionId,
								}),
							})
							.pipe(
								// Map typed errors to HTTP responses inline since
								// handleRaw doesn't get the route's error schema.
								Effect.catchTag('BadRequest', err =>
									Effect.succeed(
										HttpServerResponse.jsonUnsafe(
											{ _tag: 'BadRequest', message: err.message },
											{ status: 400 },
										),
									),
								),
								Effect.catchTag('NotFound', err =>
									Effect.succeed(
										HttpServerResponse.jsonUnsafe(
											{
												_tag: 'NotFound',
												entity: err.entity,
												id: err.id,
											},
											{ status: 404 },
										),
									),
								),
								Effect.catchTag('Conflict', err =>
									Effect.succeed(
										HttpServerResponse.jsonUnsafe(
											{ _tag: 'Conflict', message: err.message },
											{ status: 409 },
										),
									),
								),
								Effect.catchTag('SqlError', e => Effect.die(e)),
								Effect.catchTag('StorageError', e => Effect.die(e)),
							)

						// `result` is either a successful ingest payload or an
						// already-built error response (from the catch arms above).
						if (
							typeof result === 'object' &&
							result !== null &&
							'recordingId' in result
						) {
							return HttpServerResponse.jsonUnsafe({
								recordingId: result.recordingId,
								interactionId: result.interactionId,
							})
						}
						return result
					}),
				)
				.handle('list', _ =>
					svc
						.listForCompany(
							_.query.companyId,
							_.query.limit ?? 50,
							_.query.offset ?? 0,
						)
						.pipe(Effect.orDie),
				)
				.handle('get', _ =>
					svc
						.getById(_.params.id)
						.pipe(Effect.catchTag('SqlError', e => Effect.die(e))),
				)
				.handle('playback', _ =>
					svc.getPlaybackUrl(_.params.id).pipe(
						Effect.catchTag('SqlError', e => Effect.die(e)),
						Effect.catchTag('StorageError', e => Effect.die(e)),
					),
				)
				.handle('delete', _ =>
					svc.softDelete(_.params.id).pipe(
						Effect.map(() => ({ ok: true as const })),
						Effect.catchTag('SqlError', e => Effect.die(e)),
					),
				)
		}),
)

// Re-exported so the unused-import linter doesn't complain when only the
// service is referenced from main.ts wiring.
export { BadRequest }
