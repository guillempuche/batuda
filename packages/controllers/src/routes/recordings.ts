import { Schema } from 'effect'
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
} from 'effect/unstable/httpapi'

import { CallRecording, DbNumber } from '@batuda/domain'

import { BadRequest, Conflict, NotFound } from '../errors'
import { OrgMiddleware } from '../middleware/org'
import { SessionMiddleware } from '../middleware/session'

// List projection: recording metadata joined with its interaction's date,
// contact, and summary. Dates encode to ISO strings on the wire.
export const RecordingSummary = Schema.Struct({
	id: Schema.String,
	interactionId: Schema.String,
	storageKey: Schema.String,
	mimeType: Schema.String,
	// BIGINT — node-postgres returns it as a string; accept string-or-number.
	byteSize: DbNumber,
	durationSec: Schema.NullOr(Schema.Number),
	transcriptStatus: Schema.NullOr(Schema.String),
	contactId: Schema.NullOr(Schema.String),
	summary: Schema.NullOr(Schema.String),
	interactionDate: Schema.NullOr(Schema.DateTimeUtcFromString),
	createdAt: Schema.DateTimeUtcFromString,
	updatedAt: Schema.DateTimeUtcFromString,
})

// Detail: the full recording row plus the same joined interaction fields.
export const RecordingDetail = Schema.Struct({
	...CallRecording.json.fields,
	companyId: Schema.String,
	contactId: Schema.NullOr(Schema.String),
	interactionDate: Schema.NullOr(Schema.DateTimeUtcFromString),
	summary: Schema.NullOr(Schema.String),
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
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				NotFound.pipe(HttpApiSchema.status(404)),
				Conflict.pipe(HttpApiSchema.status(409)),
			],
		}),
	)
	.add(
		HttpApiEndpoint.get('list', '/recordings', {
			query: {
				companyId: Schema.String,
				limit: Schema.optional(Schema.NumberFromString),
				offset: Schema.optional(Schema.NumberFromString),
			},
			success: Schema.Array(RecordingSummary),
		}),
	)
	.add(
		HttpApiEndpoint.get('get', '/recordings/:id', {
			params: { id: Schema.String },
			success: RecordingDetail,
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
	.middleware(OrgMiddleware)
	.prefix('/v1')
