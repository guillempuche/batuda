import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// A document used to belong to exactly one company, so a note could not be
// filed against the meeting it was written for, the person it is about, the
// task it came out of, or the offer it argues for.
//
// `document_links` names the record a document is filed under by table and id,
// the way `research_links` already does, so one document can sit in several
// places at once. `organization_id` is on the link row because the isolation
// policy reads it there rather than following the parent, and `subject_id`
// carries no foreign key because one key cannot point at five tables.
//
// `interaction_id` goes with the company column. It was meant to tie a prep
// note to a meeting, nothing ever read it, and the other half of that chain
// (`calendar_events.interaction_id`) is empty in every environment including
// the seeds. A link to the meeting itself replaces it.
//
// `type` was free text, so rows exist carrying a word no picker or filter
// offers. Those become 'general'.
//
// expand-contract: pre-production clean break — this same release rewrites every
// reader and writer of `company_id` and `interaction_id` (HTTP route + handler,
// MCP tool, MCP resource, the company-research prompt, the seed, and the web
// app) to go through the link table. Nothing queries the dropped columns on the
// request path once this deploy is out. This also removes the documents table's
// only ON DELETE CASCADE: no code path hard-deletes a company today, and a
// document whose last link is removed stays reachable from the documents list
// rather than disappearing.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		CREATE TABLE IF NOT EXISTS document_links (
			organization_id TEXT NOT NULL,
			document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			subject_table TEXT NOT NULL CHECK (subject_table IN ('companies','contacts','tasks','proposals','calendar_events')),
			subject_id UUID NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (document_id, subject_table, subject_id)
		)
	`

	// "What is filed against this record" is the hot read — every subject panel
	// asks it. The org index matches the one every other org-scoped table keeps.
	yield* sql`CREATE INDEX IF NOT EXISTS document_links_subject_idx ON document_links(subject_table, subject_id)`
	yield* sql`CREATE INDEX IF NOT EXISTS idx_document_links_org ON document_links(organization_id)`

	yield* sql`GRANT SELECT, INSERT, UPDATE, DELETE ON document_links TO app_user, app_service`

	yield* sql`ALTER TABLE document_links ENABLE ROW LEVEL SECURITY`
	yield* sql`ALTER TABLE document_links FORCE ROW LEVEL SECURITY`
	yield* sql`
		CREATE POLICY org_isolation_document_links ON document_links
			TO app_user
			USING (organization_id = current_setting('app.current_org_id', true))
			WITH CHECK (organization_id = current_setting('app.current_org_id', true))
	`

	// Every document that exists today belongs to a company, so each one keeps
	// that filing.
	yield* sql`
		INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
		SELECT organization_id, id, 'companies', company_id
		FROM documents
		WHERE company_id IS NOT NULL
		ON CONFLICT DO NOTHING
	`

	// Anything filed under a word the app does not offer becomes a plain note,
	// so every row answers to one of the six kinds the pickers and filters use.
	yield* sql`
		UPDATE documents
		SET type = 'general'
		WHERE type NOT IN ('general','prenote','postnote','call_notes','visit_notes','research')
	`

	yield* sql`ALTER TABLE documents DROP COLUMN IF EXISTS company_id`
	yield* sql`ALTER TABLE documents DROP COLUMN IF EXISTS interaction_id`

	// Documents are listed newest-touched first within one organisation, which
	// is the order this index serves.
	yield* sql`CREATE INDEX IF NOT EXISTS idx_documents_org_updated ON documents(organization_id, updated_at DESC)`
})
