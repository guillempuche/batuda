import { Effect, Schema } from 'effect'
import { McpSchema, McpServer } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const docIdParam = McpSchema.param('id', Schema.String)

export const DocumentResource =
	McpServer.resource`batuda://document/${docIdParam}`({
		name: 'Document',
		description: 'Full document content by ID (markdown or other).',
		mimeType: 'application/json',
		audience: ['assistant'],
		content: Effect.fn(function* (_uri, id) {
			const sql = yield* SqlClient.SqlClient
			const rows = yield* sql`SELECT * FROM documents WHERE id = ${id} LIMIT 1`
			if (!rows[0]) return yield* Effect.die(`Document ${id} not found`)
			return JSON.stringify(rows[0], null, 2)
		}),
	})
