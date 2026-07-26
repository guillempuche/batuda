import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const docIdParam = McpSchema.param('id', Schema.String)

export const DocumentResource =
	McpServer.resource`batuda://document/${docIdParam}`({
		name: 'Document',
		description:
			'Full markdown body of a document by ID, with the CRM records it is filed against.',
		mimeType: 'application/json',
		audience: ['assistant'],
		content: Effect.fn(function* (_uri, id) {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql`SELECT * FROM documents WHERE id = ${id} LIMIT 1`
			const doc = rows[0]
			if (!doc) return yield* Effect.die(`Document ${id} not found`)
			// Where a document is filed lives in its own table, so reading the
			// row alone would hand back a document with no home.
			const subjects =
				yield* sql`SELECT subject_table, subject_id FROM document_links WHERE document_id = ${id} ORDER BY subject_table, created_at`
			return JSON.stringify({ ...doc, subjects }, null, 2)
		}),
	})
