import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Adds a denormalized FTS column on email_messages so the listThreads
// search filter stops matching against email_thread_links.subject (only
// the first message's subject) and instead matches subject + preview +
// body per message. setweight A/B/C primes the column for future ranking.
//
// `'simple'` text-search config: no stemming, language-agnostic for a
// polyglot inbox. Skips `unaccent()` because it is STABLE, which Postgres
// rejects in GENERATED ALWAYS STORED — accent-folding would need an
// IMMUTABLE SQL wrapper added later.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE email_messages
			ADD COLUMN IF NOT EXISTS search_vector tsvector
			GENERATED ALWAYS AS (
				setweight(to_tsvector('simple', coalesce(subject, '')),      'A') ||
				setweight(to_tsvector('simple', coalesce(text_preview, '')), 'B') ||
				setweight(to_tsvector('simple', coalesce(text_body, '')),    'C')
			) STORED
	`

	yield* sql`
		CREATE INDEX IF NOT EXISTS idx_email_messages_search_vector
			ON email_messages USING GIN (search_vector)
	`
})
