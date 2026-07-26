import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Documents can now hold a whole HTML page, not just markdown.
//
// The two formats are written and read differently, so they are stored
// differently. Markdown is typed by a person, edited in place, and has to be
// searchable, so it stays in `content`. HTML arrives already finished — from an
// agent or an import — is read whole and replaced whole, and is often far
// larger, so its bytes go to object storage and the row keeps only the key.
//
// That split also decides where an HTML document opens. Serving it back from
// the app's own address would put a page somebody else wrote next to the
// signed-in session; a short-lived link to the storage address does not, and
// the browser treats it as the separate place it is.
//
// `search_text` is the plain words of an HTML document, kept so searching still
// works when the body itself is not in the database. It is never shown to
// anyone — the stored bytes are what a reader sees.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		ALTER TABLE documents
			ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'markdown'
				CHECK (format IN ('markdown','html')),
			ADD COLUMN IF NOT EXISTS storage_key TEXT,
			ADD COLUMN IF NOT EXISTS search_text TEXT
	`

	// A markdown document keeps its body in `content` and an HTML one keeps a
	// key instead, so exactly one of the two is always filled in.
	yield* sql`
		ALTER TABLE documents
			ADD CONSTRAINT documents_body_matches_format CHECK (
				(format = 'markdown' AND storage_key IS NULL)
				OR (format = 'html' AND storage_key IS NOT NULL)
			)
	`
})
