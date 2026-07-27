import { DateTime, Effect, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql'

import { CurrentOrg, DocumentSummary } from '@batuda/controllers'
import {
	DOCUMENT_SUBJECT_TABLES,
	Document,
	DocumentSubjectTable,
} from '@batuda/domain'

import {
	deleteStoredFile,
	HTML_URL_TTL_SECONDS,
	linkDocument,
	rewriteStoredHtml,
	storedFileFor,
	subjectsForDocument,
	unlinkDocument,
} from '../../services/documents'
import { StorageProvider } from '../../services/storage-provider'
import {
	DocumentCreated,
	TimelineActivityService,
} from '../../services/timeline-activity'
import { ListResult, toItems } from './_result'

const REQUEST_DEPENDENCIES = [CurrentOrg]

const decodeDocument = Schema.decodeUnknownEffect(Document)

// The listing query reads the summary columns with the raw Date, so override
// just the timestamps before decoding into the wire summary shape. Built when
// the layer runs, not when the file loads: `DocumentSummary` comes from another
// package that is still being set up at that point.
const makeSummaryDecoder = () =>
	Schema.decodeUnknownEffect(
		Schema.Array(
			Schema.Struct({
				...DocumentSummary.fields,
				createdAt: Schema.DateTimeUtcFromDate,
				updatedAt: Schema.DateTimeUtcFromDate,
			}),
		),
	)

// The same amount of the body the web list shows.
const SNIPPET_CHARS = 200

// A body has no size limit, so one very long document could use up all the
// room an agent has left to think in. It comes back cut off, and says so.
const MAX_BODY_CHARS = 100_000
const truncateLongBody = (content: string) =>
	content.length > MAX_BODY_CHARS
		? `${content.slice(0, MAX_BODY_CHARS)}…[truncated]`
		: content

const SUBJECT_TABLE_CHOICES = DOCUMENT_SUBJECT_TABLES.join('|')

const GetDocuments = Tool.make('get_documents', {
	description: `List documents filed against a CRM record. subject_table (${SUBJECT_TABLE_CHOICES}) + subject_id narrows to one record; type and q (substring of title or body) filter further; all are optional and combinable. Returns id, type, title, timestamps, a short snippet and where each document is filed — NOT the full body. Call get_document for that.`,
	parameters: Schema.Struct({
		subject_table: Schema.optional(DocumentSubjectTable),
		subject_id: Schema.optional(Schema.String),
		type: Schema.optional(Document.json.fields.type),
		q: Schema.optional(Schema.String),
	}),
	success: ListResult(DocumentSummary),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'List Documents')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const GetDocument = Tool.make('get_document', {
	description: `Get a single document and the records it is filed against. A markdown document carries its body in \`content\`, cut off past ${MAX_BODY_CHARS} characters with a trailing "…[truncated]". A web page (format=html) has an empty \`content\` and a short-lived \`bodyUrl\` to fetch it from instead — that link is the only way to read one, and it expires.`,
	parameters: Schema.Struct({
		id: Schema.String,
	}),
	success: Schema.Struct({
		...Document.json.fields,
		// Null for markdown, whose body is right here in `content`.
		bodyUrl: Schema.NullOr(Schema.String),
		subjects: Schema.Array(
			Schema.Struct({
				subjectTable: DocumentSubjectTable,
				subjectId: Schema.String,
			}),
		),
	}),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Get Document')
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.OpenWorld, false)

const CreateDocument = Tool.make('create_document', {
	description: `Create a document filed against a CRM record: subject_table (${SUBJECT_TABLE_CHOICES}) + subject_id say where it belongs, and attach_document files the same document in more places afterwards. Content is markdown. A prep note for a meeting is filed against that calendar_event, not against the company.`,
	parameters: Schema.Struct({
		subject_table: DocumentSubjectTable,
		subject_id: Schema.String,
		type: Document.json.fields.type,
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
	description:
		'Update a document title, body or type. Only the fields you pass change.',
	parameters: Schema.Struct({
		id: Schema.String,
		type: Schema.optional(Document.json.fields.type),
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

const DeleteDocument = Tool.make('delete_document', {
	description:
		'Permanently delete a document and every filing of it. There is no version history, so the body is gone. An id that is already gone still reports deleted. To keep the document but stop showing it against one record, use detach_document instead.',
	parameters: Schema.Struct({ id: Schema.String }),
	success: Schema.Struct({ status: Schema.Literal('deleted') }),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Delete Document')
	.annotate(Tool.Destructive, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const AttachDocument = Tool.make('attach_document', {
	description: `File an existing document against one more CRM record: subject_table (${SUBJECT_TABLE_CHOICES}) + subject_id. A document can be filed in any number of places, and filing it where it already sits is a no-op. Returns not_found when the record does not exist or belongs to another organisation.`,
	parameters: Schema.Struct({
		id: Schema.String,
		subject_table: DocumentSubjectTable,
		subject_id: Schema.String,
	}),
	success: Schema.Union([
		Schema.Struct({ status: Schema.Literal('attached') }),
		Schema.Struct({ error: Schema.Literal('not_found') }),
	]),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Attach Document')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

const DetachDocument = Tool.make('detach_document', {
	description:
		'Stop filing a document against one record. The document itself survives, along with its other filings; unfiling something already unfiled is a no-op.',
	parameters: Schema.Struct({
		id: Schema.String,
		subject_table: DocumentSubjectTable,
		subject_id: Schema.String,
	}),
	success: Schema.Struct({ status: Schema.Literal('detached') }),
	dependencies: REQUEST_DEPENDENCIES,
})
	.annotate(Tool.Title, 'Detach Document')
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false)

export const DocumentTools = Toolkit.make(
	GetDocuments,
	GetDocument,
	CreateDocument,
	UpdateDocument,
	DeleteDocument,
	AttachDocument,
	DetachDocument,
)

export const DocumentHandlersLive = DocumentTools.toLayer(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const storage = yield* StorageProvider
		const timeline = yield* TimelineActivityService
		const decodeSummaries = makeSummaryDecoder()
		return {
			get_documents: params =>
				Effect.gen(function* () {
					const conditions = []
					if (params.subject_table && params.subject_id) {
						conditions.push(sql`EXISTS (
							SELECT 1 FROM document_links dl
							WHERE dl.document_id = d.id
								AND dl.subject_table = ${params.subject_table}
								AND dl.subject_id = ${params.subject_id}
						)`)
					}
					if (params.type) conditions.push(sql`d.type = ${params.type}`)
					if (params.q) {
						// A search term is a plain substring, so the characters
						// Postgres reads as wildcards have to be escaped or a stray
						// `%` matches everything.
						const needle = `%${params.q.replace(/[\\%_]/g, match => `\\${match}`)}%`
						conditions.push(
							sql`(d.title ILIKE ${needle} OR d.content ILIKE ${needle})`,
						)
					}
					const whereClause =
						conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
					const rows = yield* sql`
						SELECT
							d.id, d.type, d.title, d.created_at, d.updated_at,
							left(d.content, ${SNIPPET_CHARS}) AS snippet,
							COALESCE((
								SELECT json_agg(json_build_object(
									'subjectTable', dl.subject_table,
									'subjectId', dl.subject_id
								) ORDER BY dl.subject_table, dl.created_at)
								FROM document_links dl WHERE dl.document_id = d.id
							), '[]'::json) AS subjects
						FROM documents d
						${whereClause}
						ORDER BY d.updated_at DESC
						LIMIT 100
					`
					return toItems(yield* decodeSummaries(rows))
				}).pipe(Effect.orDie),
			get_document: ({ id }) =>
				Effect.gen(function* () {
					const rows =
						yield* sql`SELECT * FROM documents WHERE id = ${id} LIMIT 1`
					const doc = rows[0]
					if (!doc) return yield* Effect.die(`Document ${id} not found`)
					const decoded = yield* decodeDocument(doc)
					const subjects = yield* subjectsForDocument(sql, id)
					// An agent authenticates with a key and has no browser session,
					// so it gets a short-lived link straight to the stored page
					// rather than the address a person opens.
					const storageKey = yield* storedFileFor(sql, id)
					const bodyUrl =
						storageKey === null
							? null
							: yield* storage
									.signedUrl(storageKey, HTML_URL_TTL_SECONDS)
									.pipe(Effect.orDie)
					return {
						...decoded,
						content: truncateLongBody(decoded.content),
						bodyUrl,
						subjects,
					}
				}).pipe(Effect.orDie),
			create_document: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					// The row and its first filing land together, so a filing that
					// turns out to be impossible takes the document back out with
					// it. The local stdio surface has no request transaction of its
					// own to fall back on.
					const created = yield* sql
						.withTransaction(
							Effect.gen(function* () {
								const rows = yield* sql<{ id: string; title: string | null }>`
									INSERT INTO documents ${sql.insert({
										organizationId: currentOrg.id,
										type: params.type,
										title: params.title,
										content: params.content,
									})} RETURNING id, title
								`
								const row = rows[0]
								if (!row) {
									return yield* Effect.die(
										new Error('INSERT INTO documents RETURNING yielded no row'),
									)
								}
								const linked = yield* linkDocument(
									sql,
									currentOrg.id,
									row.id,
									params.subject_table,
									params.subject_id,
								)
								if (!linked) {
									return yield* Effect.die(
										new Error(
											`document subject ${params.subject_table}/${params.subject_id} not found`,
										),
									)
								}
								return row
							}),
						)
						.pipe(Effect.orDie)

					yield* timeline.record(
						new DocumentCreated({
							documentId: created.id,
							companyId:
								params.subject_table === 'companies' ? params.subject_id : null,
							contactId:
								params.subject_table === 'contacts' ? params.subject_id : null,
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
					const storageKey = yield* storedFileFor(sql, id)
					const data: Record<string, unknown> = {
						...fields,
						...(storageKey !== null && fields.content !== undefined
							? yield* rewriteStoredHtml(storage, storageKey, fields.content)
							: {}),
						updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
					}
					const rows =
						yield* sql`UPDATE documents SET ${sql.update(data, ['id'])} WHERE id = ${id} RETURNING *`
					const row = rows[0]
					return row === undefined ? null : yield* decodeDocument(row)
				}).pipe(Effect.orDie),
			delete_document: ({ id }) =>
				Effect.gen(function* () {
					// Read where the bytes are before the row that names them goes.
					const storageKey = yield* storedFileFor(sql, id)
					// The filings go with the document through their foreign key.
					yield* sql`DELETE FROM documents WHERE id = ${id}`
					if (storageKey !== null) {
						yield* deleteStoredFile(storage, id, storageKey)
					}
					return { status: 'deleted' as const }
				}).pipe(Effect.orDie),
			attach_document: params =>
				Effect.gen(function* () {
					const currentOrg = yield* CurrentOrg
					const linked = yield* linkDocument(
						sql,
						currentOrg.id,
						params.id,
						params.subject_table,
						params.subject_id,
					)
					return linked
						? { status: 'attached' as const }
						: { error: 'not_found' as const }
				}).pipe(Effect.orDie),
			detach_document: params =>
				Effect.gen(function* () {
					yield* unlinkDocument(
						sql,
						params.id,
						params.subject_table,
						params.subject_id,
					)
					return { status: 'detached' as const }
				}).pipe(Effect.orDie),
		}
	}),
)
