import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'

// Three places kept a free-text box of their own: a contact, a task and a
// proposal each had `notes`. None of them talked to each other, none could hold
// more than one note, and the one on a contact was never shown on any screen —
// written by the contacts form, the agent tool and the research apply path, and
// read by nobody but a language model.
//
// Now that a document can be filed against any of those records, the boxes have
// nothing left to do. Whatever was written in one becomes a document filed
// against the row it came from, so nothing is lost and everything ends up
// somewhere it can be found, searched and read.
//
// Each note becomes two rows written together — the document and the filing
// that says where it belongs — because a document filed nowhere is one nothing
// can reach.
//
// expand-contract: pre-production clean break — this same release rewrites every
// reader and writer of the three columns (domain schemas, HTTP payloads,
// handlers, agent tools, the task search, the proposals panel and the seeds).
// Nothing queries them on the request path once this deploy is out.

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient

	yield* sql`
		WITH source AS (
			SELECT id AS subject_id, organization_id, notes, gen_random_uuid() AS document_id
			FROM contacts WHERE notes IS NOT NULL AND btrim(notes) <> ''
		), created AS (
			INSERT INTO documents (id, organization_id, type, format, title, content)
			SELECT document_id, organization_id, 'general', 'markdown', 'Notes', notes FROM source
		)
		INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
		SELECT organization_id, document_id, 'contacts', subject_id FROM source
	`

	yield* sql`
		WITH source AS (
			SELECT id AS subject_id, organization_id, notes, gen_random_uuid() AS document_id
			FROM tasks WHERE notes IS NOT NULL AND btrim(notes) <> ''
		), created AS (
			INSERT INTO documents (id, organization_id, type, format, title, content)
			SELECT document_id, organization_id, 'general', 'markdown', 'Notes', notes FROM source
		)
		INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
		SELECT organization_id, document_id, 'tasks', subject_id FROM source
	`

	yield* sql`
		WITH source AS (
			SELECT id AS subject_id, organization_id, notes, gen_random_uuid() AS document_id
			FROM proposals WHERE notes IS NOT NULL AND btrim(notes) <> ''
		), created AS (
			INSERT INTO documents (id, organization_id, type, format, title, content)
			SELECT document_id, organization_id, 'general', 'markdown', 'Notes', notes FROM source
		)
		INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
		SELECT organization_id, document_id, 'proposals', subject_id FROM source
	`

	yield* sql`ALTER TABLE contacts DROP COLUMN IF EXISTS notes`
	yield* sql`ALTER TABLE tasks DROP COLUMN IF EXISTS notes`
	yield* sql`ALTER TABLE proposals DROP COLUMN IF EXISTS notes`
})
