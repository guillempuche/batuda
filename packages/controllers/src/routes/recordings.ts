import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { BadRequest, Conflict, NotFound } from '../errors'
import { SessionMiddleware } from '../middleware/session'

const RecordingMetadata = Schema.Struct({
	id: Schema.String,
	interactionId: Schema.String,
	companyId: Schema.optional(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	storageKey: Schema.String,
	mimeType: Schema.String,
	byteSize: Schema.Number,
	durationSec: Schema.NullOr(Schema.Number),
	transcriptStatus: Schema.NullOr(Schema.String),
	createdAt: Schema.Unknown,
	updatedAt: Schema.Unknown,
})

export const RecordingsGroup = HttpApiGroup.make('recordings')
	.add(
		// Multipart upload — payload schema is Unknown because handleRaw
		// reads the request body directly. The fields the handler expects
		// (audio File, plus companyId/interactionId/contactId/durationSec
		// Field strings) are documented in the handler's parsing logic.
		HttpApiEndpoint.post('upload', '/recordings', {
			payload: Schema.Unknown,
			success: Schema.Struct({
				recordingId: Schema.String,
				interactionId: Schema.String,
			}),
			error: Schema.Union([
				BadRequest.pipe(HttpApiSchema.status(400)),
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			]),
		}),
	)
	.add(
		HttpApiEndpoint.get('list', '/recordings', {
			query: {
				companyId: Schema.String,
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(Schema.Unknown),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/recordings/:id', {
			params: { id: Schema.String },
			success: Schema.Unknown,
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.get('playback', '/recordings/:id/playback', {
			params: { id: Schema.String },
			success: Schema.Struct({
				url: Schema.String,
				expiresAt: Schema.String,
			}),
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.add(
		HttpApiEndpoint.delete('delete', '/recordings/:id', {
			params: { id: Schema.String },
			success: Schema.Struct({ ok: Schema.Boolean }),
			error: NotFound.pipe(HttpApiSchema.status(404)),
		}),
	)
	.middleware(SessionMiddleware)
	.prefix('/v1')

// Re-export for handler reference (matches the existing routes pattern)
export { RecordingMetadata }
