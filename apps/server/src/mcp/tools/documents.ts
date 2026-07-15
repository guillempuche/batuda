import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, DocumentSummary } from '@batuda/controllers'
import { Document } from '@batuda/domain'

import {
	DocumentCreated,
	TimelineActivityService,
} from '../../services/timeline-activity'
import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg]

const decodeDocument = Schema.decodeUnknownEffect(Document)
// The listing query reads the summary columns with the raw Date, so override
// just the timestamp before decoding into the wire summary shape.
const DocumentSummaryRow = Schema.Struct({
	...DocumentSummary.fields,
	createdAt: Schema.DateTimeUtcFromDate,
})
const decodeSummaries = Schema.decodeUnknownEffect(
	Schema.Array(DocumentSummaryRow),
)

const GetDocuments = Tool.make('get_documents', {
	description:
		'List documents for a company. Returns id, type, and title only — NOT content. Call get_document for full content.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		type: Schema.optional(Schema.String),
	}),
	success: ListResult(DocumentSummary),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Documents')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetDocument = Tool.make('get_document', {
	description: 'Get a single document with full markdown content.',
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Document.json,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Document')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateDocument = Tool.make('create_document', {
	description:
		'Create a document for a company. Type: note|proposal|contract|report|brief|other. Content: full markdown.',
	parameters: Schema.Struct({
		company_id: Schema.String,
		interaction_id: Schema.optional(Schema.String),
		type: Schema.String,
		title: Schema.optional(Schema.String),
		content: Schema.String,
	}),
	success: Document.json,
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Create Document')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const UpdateDocument = Tool.make('update_document', {
	description: 'Update a document content or title.',
	parameters: Schema.Struct({
		id: Schema.String,
		title: Schema.optional(Schema.String),
		content: Schema.optional(Schema.String),
	}),
	success: Schema.NullOr(Document.json),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Update Document')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const DocumentTools = Toolkit.make(
	GetDocuments,
	GetDocument,
	CreateDocument,
	UpdateDocument,
)

export const DocumentHandlersLive = DocumentTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const timeline = yield* TimelineActivityService
		return {
			get_documents: params =>
				Effect.gen(function* () {
					const conditions = [sql`company_id = ${params.company_id}`]
					if (params.type) conditions.push(sql`type = ${params.type}`)
					const rows =
						yield* sql`SELECT id, company_id, type, title, created_at FROM documents WHERE ${sql.and(conditions)}`
					return toItems(yield* decodeSummaries(rows))
				}).pipe(Effect.orDie),
			get_document: ({ id }) =>
				Effect.gen(function* () {
					const rows =
						yield* sql`SELECT * FROM documents WHERE id = ${id} LIMIT 1`
					const doc = rows[0]
					if (!doc) return yield* Effect.die(`Document ${id} not found`)
					return yield* decodeDocument(doc)
				}).pipe(Effect.orDie),
			create_document: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const rows = yield* sql<{ id: string; title: string | null }>`
						INSERT INTO documents ${sql.insert({
							organizationId: currentOrg.id,
							companyId: params.company_id,
							interactionId: params.interaction_id,
							type: params.type,
							title: params.title,
							content: params.content,
						})} RETURNING id, title
					`
					const created = rows[0]
					if (!created) {
						return yield* Effect.die(
							new Error('INSERT INTO documents RETURNING yielded no row'),
						)
					}
					yield* timeline.record(
						new DocumentCreated({
							documentId: created.id,
							companyId: params.company_id,
							contactId: null,
							title: created.title ?? params.type,
							actorUserId: null,
							occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
						}),
					)
					const full =
						yield* sql`SELECT * FROM documents WHERE id = ${created.id} LIMIT 1`
					const doc = full[0]
					if (!doc)
						return yield* Effect.die(
							new Error('document vanished after insert'),
						)
					return yield* decodeDocument(doc)
				}).pipe(Effect.orDie),
			update_document: ({ id, ...fields }) =>
				Effect.gen(function* () {
					const data: Record<string, unknown> = {
						...fields,
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}
					const rows =
						yield* sql`UPDATE documents SET ${sql.update(data, ['id'])} WHERE id = ${id} RETURNING *`
					const row = rows[0]
					return row === undefined ? null : yield* decodeDocument(row)
				}).pipe(Effect.orDie),
		}
	}),
)
