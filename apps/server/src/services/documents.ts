import { Effect } from 'effect'
import type { SqlClient } from 'effect/unstable/sql'

import type { DocumentSubjectTable } from '@batuda/domain'

import type { StorageProvider } from './storage-provider'

/**
 * Filing documents against CRM records.
 *
 * The web app and the agent tools both file documents, and a second copy of the
 * rules is how the two would drift apart.
 *
 * A link names its record by table and id, which no foreign key can enforce, so
 * the record is checked for existence and ownership before a link is written.
 */

/**
 * Is this record real, and does it belong to this organisation?
 *
 * A branch per table keeps the table name a literal rather than a value dropped
 * into the statement. Companies and contacts can be retired without being
 * removed, and a retired one should not accept new filings; the other three
 * have no such state.
 */
const subjectExists = (
	sql: SqlClient.SqlClient,
	orgId: string,
	subjectTable: DocumentSubjectTable,
	subjectId: string,
) => {
	switch (subjectTable) {
		case 'companies':
			return sql<{
				id: string
			}>`SELECT id FROM companies WHERE id = ${subjectId} AND organization_id = ${orgId} AND deleted_at IS NULL LIMIT 1`
		case 'contacts':
			return sql<{
				id: string
			}>`SELECT id FROM contacts WHERE id = ${subjectId} AND organization_id = ${orgId} AND deleted_at IS NULL LIMIT 1`
		case 'tasks':
			return sql<{
				id: string
			}>`SELECT id FROM tasks WHERE id = ${subjectId} AND organization_id = ${orgId} LIMIT 1`
		case 'proposals':
			return sql<{
				id: string
			}>`SELECT id FROM proposals WHERE id = ${subjectId} AND organization_id = ${orgId} LIMIT 1`
		case 'calendar_events':
			return sql<{
				id: string
			}>`SELECT id FROM calendar_events WHERE id = ${subjectId} AND organization_id = ${orgId} LIMIT 1`
	}
}

/**
 * File a document against a record, if that record is really there.
 *
 * Returns false when the record does not exist or belongs to someone else, so a
 * caller can answer "not found" instead of leaving a link pointing at nothing.
 * Filing the same pair twice is not an error — it just stays filed once.
 */
export const linkDocument = (
	sql: SqlClient.SqlClient,
	orgId: string,
	documentId: string,
	subjectTable: DocumentSubjectTable,
	subjectId: string,
): Effect.Effect<boolean, never, never> =>
	Effect.gen(function* () {
		// Both ends are checked, not just the record. The isolation policy keeps
		// another organisation's document out of any result the caller reads, but
		// the link's foreign key is checked by the database itself and ignores
		// that policy — so without this, filing against a document id belonging to
		// somebody else would succeed and quietly report whether that id is real.
		const [document] = yield* sql<{ id: string }>`
			SELECT id FROM documents
			WHERE id = ${documentId} AND organization_id = ${orgId}
			LIMIT 1
		`
		if (!document) return false
		const [subject] = yield* subjectExists(sql, orgId, subjectTable, subjectId)
		if (!subject) return false
		yield* sql`
			INSERT INTO document_links (organization_id, document_id, subject_table, subject_id)
			VALUES (${orgId}, ${documentId}, ${subjectTable}, ${subjectId})
			ON CONFLICT DO NOTHING
		`
		return true
	}).pipe(Effect.orDie)

/** Stop filing a document against a record. Unfiling twice is harmless. */
export const unlinkDocument = (
	sql: SqlClient.SqlClient,
	documentId: string,
	subjectTable: DocumentSubjectTable,
	subjectId: string,
) =>
	sql`
		DELETE FROM document_links
		WHERE document_id = ${documentId}
			AND subject_table = ${subjectTable}
			AND subject_id = ${subjectId}
	`.pipe(Effect.orDie)

/**
 * Drop every filing that points at a record about to be deleted.
 *
 * `subject_id` has no foreign key, so nothing removes these on its own — the
 * links would outlive the row and point at an id that no longer resolves. Call
 * this from each delete path, in the same transaction as the delete.
 */
export const unlinkSubject = (
	sql: SqlClient.SqlClient,
	subjectTable: DocumentSubjectTable,
	subjectId: string,
) =>
	sql`
		DELETE FROM document_links
		WHERE subject_table = ${subjectTable} AND subject_id = ${subjectId}
	`.pipe(Effect.orDie)

export type DocumentSubjectRow = {
	readonly subjectTable: DocumentSubjectTable
	readonly subjectId: string
}

/**
 * The plain words of an HTML page, for searching only.
 *
 * An HTML document's body lives in storage, so a search over the database would
 * miss it entirely without this. It never reaches a reader — what someone opens
 * is the stored page itself — so a careful strip is enough here and no HTML
 * parser is warranted. Script and style blocks go first, contents and all, or
 * their code would turn up as search hits.
 */
export const searchTextFromHtml = (html: string): string =>
	html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/\s+/g, ' ')
		.trim()

/** Where an HTML document's bytes live. */
export const htmlStorageKey = (orgId: string, documentId: string): string =>
	`documents/${orgId}/${documentId}.html`

/** How long a link to a stored document stays good for. */
export const HTML_URL_TTL_SECONDS = 600

/** Where a single document is filed. */
export const subjectsForDocument = (
	sql: SqlClient.SqlClient,
	documentId: string,
) =>
	sql<DocumentSubjectRow>`
		SELECT subject_table, subject_id FROM document_links
		WHERE document_id = ${documentId}
		ORDER BY subject_table, created_at
	`.pipe(Effect.orDie)

/**
 * The stored file behind an HTML document, or nothing for a markdown one, whose
 * body is on the row itself.
 */
export const storedFileFor = (sql: SqlClient.SqlClient, documentId: string) =>
	Effect.gen(function* () {
		const rows = yield* sql<{
			format: string
			storageKey: string | null
		}>`SELECT format, storage_key FROM documents WHERE id = ${documentId} LIMIT 1`
		const row = rows[0]
		if (!row || row.format !== 'html' || !row.storageKey) return null
		return row.storageKey
	}).pipe(Effect.orDie)

/**
 * Remove the stored page behind a document that is being deleted.
 *
 * Deliberately best-effort: a storage failure leaves a file nobody can reach,
 * which is better than refusing to delete the document.
 */
export const deleteStoredFile = (
	storage: StorageProvider['Service'],
	documentId: string,
	storageKey: string,
) =>
	storage.delete(storageKey).pipe(
		Effect.catchTag('StorageError', error =>
			Effect.logError('Stored page outlived its document').pipe(
				Effect.annotateLogs({
					event: 'document.storage_delete_failed',
					documentId,
					storageKey,
					error: error.message,
				}),
			),
		),
	)

/**
 * Write a web page's new body where the page is actually read from, and return
 * the row fields that go with it.
 *
 * Putting new HTML on the row instead would leave the stored page serving the
 * old bytes, with no error. The plain words move with it, or a search would keep
 * finding the page by wording it no longer contains.
 */
export const rewriteStoredHtml = (
	storage: StorageProvider['Service'],
	storageKey: string,
	content: string,
) =>
	storage
		.put({
			key: storageKey,
			body: new TextEncoder().encode(content),
			contentType: 'text/html; charset=utf-8',
		})
		.pipe(
			Effect.orDie,
			Effect.as({ content: '', searchText: searchTextFromHtml(content) }),
		)
