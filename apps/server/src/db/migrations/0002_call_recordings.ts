import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.all([
		sql`
			CREATE TABLE IF NOT EXISTS call_recordings (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				interaction_id UUID NOT NULL UNIQUE REFERENCES interactions(id) ON DELETE CASCADE,
				storage_key TEXT NOT NULL,
				mime_type TEXT NOT NULL,
				byte_size BIGINT NOT NULL,
				duration_sec INTEGER,

				transcript_status TEXT,
				transcript_text TEXT,
				transcript_segments JSONB,
				detected_languages JSONB,
				transcribed_at TIMESTAMPTZ,
				transcript_error TEXT,
				provider TEXT,
				provider_request_id TEXT,
				caller_speaker_id TEXT,

				deleted_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`,
		// Partial index for the common "list active recordings" path. The
		// UNIQUE constraint on interaction_id already provides a btree index
		// for joins/attach lookups, so no separate idx is needed for that.
		sql`CREATE INDEX IF NOT EXISTS idx_call_recordings_active ON call_recordings(deleted_at) WHERE deleted_at IS NULL`,
	])
})
