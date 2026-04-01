import { Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

const GetDocuments = Tool.make('get_documents', {
	description:
		'List documents for a company. Returns id, type, and title only — NOT content. Call get_document for full content.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		type: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})

const GetDocument = Tool.make('get_document', {
	description: 'Get a single document with full markdown content.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Unknown,
})

const CreateDocument = Tool.make('create_document', {
	description:
		'Create a document for a company. Content should be full markdown.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		interaction_id: Schema.optional(Schema.String),
		type: Schema.String,
		title: Schema.optional(Schema.String),
		content: Schema.String,
	}),
	success: Schema.Unknown,
})

const UpdateDocument = Tool.make('update_document', {
	description: 'Update a document content or title.',
	parameters: Schema.Struct({
		id: Schema.String,
		title: Schema.optional(Schema.String),
		content: Schema.optional(Schema.String),
	}),
	success: Schema.Unknown,
})

export const DocumentTools = Toolkit.make(
	GetDocuments,
	GetDocument,
	CreateDocument,
	UpdateDocument,
)

export const DocumentHandlersLive = DocumentTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			get_documents: params =>
				Effect.gen(function* () {
					const conditions = [sql`company_id = ${params.company_id}`]
					if (params.type) conditions.push(sql`type = ${params.type}`)
					return yield* sql`SELECT id, company_id, type, title, created_at FROM documents WHERE ${sql.and(conditions)}`
				}).pipe(Effect.orDie),
			get_document: ({ id }) =>
				Effect.gen(function* () {
					const rows =
						yield* sql`SELECT * FROM documents WHERE id = ${id} LIMIT 1`
					const doc = rows[0]
					if (!doc) return yield* Effect.die(`Document ${id} not found`)
					return doc
				}).pipe(Effect.orDie),
			create_document: params =>
				Effect.gen(function* () {
					const rows = yield* sql`INSERT INTO documents ${sql.insert({
						companyId: params.company_id,
						interactionId: params.interaction_id,
						type: params.type,
						title: params.title,
						content: params.content,
					})} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
			update_document: ({ id, ...fields }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {
						...fields,
						updatedAt: new Date(),
					}
					const rows =
						yield* sql`UPDATE documents SET ${sql.update(data, ['id'])} WHERE id = ${id} RETURNING *`
					return rows[0]
				}).pipe(Effect.orDie),
		}
	}),
)
