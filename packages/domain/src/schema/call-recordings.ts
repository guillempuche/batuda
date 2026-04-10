import { Schema } from 'effect'
import { Model } from 'effect/unstable/schema'

export const CallRecordingId = Schema.String.pipe(
	Schema.brand('CallRecordingId'),
)

// Transcription lifecycle. Nullable in this phase — every row stays at NULL
// until the transcription provider lands in a later phase. We deliberately
// have **no DEFAULT** on the column so a NULL means "transcription not
// attempted yet" rather than "fresh, waiting to be processed".
export const TranscriptStatus = Schema.Literals(['pending', 'done', 'failed'])
export type TranscriptStatus = typeof TranscriptStatus.Type

export class CallRecording extends Model.Class<CallRecording>('CallRecording')({
	id: Model.Generated(CallRecordingId),
	// 1:1 with the interactions row that represents this touchpoint. The
	// UNIQUE constraint at the DB level ensures a given interaction can have
	// at most one recording attached.
	interactionId: Schema.String,

	// Object storage location — `recordings/<companyId>/<ulid>.<ext>` shape.
	storageKey: Schema.String,
	mimeType: Schema.String,
	byteSize: Schema.Number,
	// Optional — populated when the upload includes a duration hint or once
	// transcription extracts it. Audio files alone don't always carry it.
	durationSec: Schema.NullOr(Schema.Number),

	// --- Transcription columns. All nullable, no DEFAULT. Populated when
	// the transcription provider phase lands. Schema lives here now so the
	// future addition is one provider Layer + one service method, no migration.
	transcriptStatus: Schema.NullOr(TranscriptStatus),
	transcriptText: Schema.NullOr(Schema.String),
	transcriptSegments: Schema.NullOr(Schema.Unknown),
	detectedLanguages: Schema.NullOr(Schema.Unknown),
	transcribedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	transcriptError: Schema.NullOr(Schema.String),
	provider: Schema.NullOr(Schema.String),
	providerRequestId: Schema.NullOr(Schema.String),
	// Which diarized speaker is the salesperson. Meaningless until diarization
	// ships — kept null in this phase.
	callerSpeakerId: Schema.NullOr(Schema.String),

	// GDPR soft-delete. The audio object in S3 is purged immediately on
	// delete; this column marks the row inactive but keeps the metadata
	// for audit/legal-hold purposes.
	deletedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
	createdAt: Model.DateTimeInsertFromDate,
	updatedAt: Model.DateTimeInsertFromDate,
}) {}
