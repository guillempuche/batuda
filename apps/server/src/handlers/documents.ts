import { randomUUID } from 'node:crypto'

import { DateTime, Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import {
	BatudaApi,
	CurrentOrg,
	DocumentSummary,
	NotFound,
} from '@batuda/controllers'
import { Document, type DocumentSubjectTable } from '@batuda/domain'

import { resolvePageTotal } from '../lib/sql-pagination'
import {
	type DocumentSubjectRow,
	HTML_URL_TTL_SECONDS,
	htmlStorageKey,
	linkDocument,
	searchTextFromHtml,
	subjectsForDocument,
	unlinkDocument,
} from '../services/documents'
import { StorageProvider } from '../services/storage-provider'
import {
	DocumentCreated,
	TimelineActivityService,
} from '../services/timeline-activity'

const decodeDocument = Schema.decodeUnknownEffect(Document)

// The listing query reads its columns straight from Postgres, so the timestamps
// arrive as raw dates; only those need overriding before the rows decode into
// the wire summary shape.
//
// Built when the layer runs rather than when the file loads: `DocumentSummary`
// comes from another package that is still being set up at that point, and
// reading it too early throws.
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

// How much of the body a list row shows. Long enough to recognise a document,
// short enough that a page of them is not a page of whole documents.
const SNIPPET_CHARS = 200

// A search term is a plain substring, so the characters Postgres reads as
// wildcards have to be escaped or a stray `%` matches everything.
const likeNeedle = (search: string) =>
	`%${search.replace(/[\\%_]/g, match => `\\${match}`)}%`

export const DocumentsLive = HttpApiBuilder.group(
	BatudaApi,
	'documents',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const storage = yield* StorageProvider
			const timeline = yield* TimelineActivityService
			const decodeSummaries = makeSummaryDecoder()

			const detailFor = (row: unknown, id: string) =>
				Effect.gen(function* () {
					const doc = yield* decodeDocument(row)
					const subjects = yield* subjectsForDocument(sql, id)
					const storageKey = (row as { storageKey?: string | null }).storageKey
					// The link is minted per read and expires, so one copied out of
					// a log or a shared screen stops working shortly after.
					const htmlUrl =
						doc.format === 'html' && storageKey
							? yield* storage
									.signedUrl(storageKey, HTML_URL_TTL_SECONDS)
									.pipe(Effect.orDie)
							: null
					return { ...doc, subjects, htmlUrl }
				})

			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const limit = Math.min(_.query.limit ?? 50, 200)
						const offset = _.query.offset ?? 0
						const conditions: Array<Statement.Fragment> = []
						if (_.query.subjectTable && _.query.subjectId) {
							conditions.push(sql`EXISTS (
								SELECT 1 FROM document_links dl
								WHERE dl.document_id = d.id
									AND dl.subject_table = ${_.query.subjectTable}
									AND dl.subject_id = ${_.query.subjectId}
							)`)
						}
						if (_.query.type) conditions.push(sql`d.type = ${_.query.type}`)
						if (_.query.q) {
							const needle = likeNeedle(_.query.q)
							conditions.push(
								// An HTML body is not in the database, so its plain words
								// are what the search has to match against.
								sql`(d.title ILIKE ${needle} OR d.content ILIKE ${needle} OR d.search_text ILIKE ${needle})`,
							)
						}
						const whereClause =
							conditions.length > 0 ? sql`WHERE ${sql.and(conditions)}` : sql``
						const rows = yield* sql<{
							readonly total: string | number
							readonly id: string
						}>`
							SELECT
								d.id, d.type, d.format, d.title, d.created_at, d.updated_at,
								left(COALESCE(NULLIF(d.content, ''), d.search_text, ''), ${SNIPPET_CHARS}) AS snippet,
								COALESCE((
									SELECT json_agg(json_build_object(
										'subjectTable', dl.subject_table,
										'subjectId', dl.subject_id
									) ORDER BY dl.subject_table, dl.created_at)
									FROM document_links dl WHERE dl.document_id = d.id
								), '[]'::json) AS subjects,
								COUNT(*) OVER () AS total
							FROM documents d
							${whereClause}
							ORDER BY d.updated_at DESC
							LIMIT ${limit} OFFSET ${offset}
						`
						const total = yield* resolvePageTotal(
							rows,
							offset,
							() => sql<{ readonly count: string | number }>`
								SELECT count(*) AS count FROM documents d
								${whereClause}
							`,
						)
						const items = yield* decodeSummaries(rows)
						return { items, total, limit, offset }
					}).pipe(Effect.orDie),
				)
				.handle('get', _ =>
					Effect.gen(function* () {
						const rows =
							yield* sql`SELECT * FROM documents WHERE id = ${_.params.id} LIMIT 1`
						const doc = rows[0]
						if (!doc)
							return yield* new NotFound({
								entity: 'document',
								id: _.params.id,
							})
						return yield* detailFor(doc, _.params.id)
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const payload = _.payload
						const isHtml = payload.format === 'html'
						// The id is chosen here rather than by the database, because
						// an HTML body is stored under a name built from it and the
						// row has to carry that name from the moment it exists.
						const documentId = randomUUID()
						const storageKey = isHtml
							? htmlStorageKey(currentOrg.id, documentId)
							: null

						// Bytes first. A stored page with no row is invisible and
						// costs a little space; a row pointing at a page that was
						// never written is a document that opens to nothing.
						if (storageKey !== null) {
							yield* storage
								.put({
									key: storageKey,
									body: new TextEncoder().encode(payload.content),
									contentType: 'text/html; charset=utf-8',
								})
								.pipe(Effect.orDie)
						}

						// The row and its first filing land together, so a filing
						// that turns out to be impossible takes the document back
						// out with it: a document filed nowhere is one nothing can
						// reach.
						const created = yield* sql
							.withTransaction(
								Effect.gen(function* () {
									const rows = yield* sql<{
										id: string
										title: string | null
									}>`
										INSERT INTO documents ${sql.insert({
											id: documentId,
											organizationId: currentOrg.id,
											type: payload.type,
											format: payload.format ?? 'markdown',
											title: payload.title,
											// An HTML body lives in storage; only its plain
											// words stay behind, so search still reaches it.
											content: isHtml ? '' : payload.content,
											searchText: isHtml
												? searchTextFromHtml(payload.content)
												: null,
											storageKey,
										})} RETURNING id, title
									`
									const row = rows[0]
									if (!row) {
										return yield* Effect.die(
											new Error(
												'INSERT INTO documents RETURNING yielded no row',
											),
										)
									}
									const linked = yield* linkDocument(
										sql,
										currentOrg.id,
										row.id,
										payload.subjectTable,
										payload.subjectId,
									)
									if (!linked) {
										return yield* Effect.die(
											new Error(
												`document subject ${payload.subjectTable}/${payload.subjectId} not found`,
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
									payload.subjectTable === 'companies'
										? payload.subjectId
										: null,
								contactId:
									payload.subjectTable === 'contacts'
										? payload.subjectId
										: null,
								title: created.title ?? payload.type,
								actorUserId: null,
								occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}),
						)
						yield* Effect.logInfo('Document created').pipe(
							Effect.annotateLogs({
								event: 'document.created',
								subjectTable: payload.subjectTable,
								type: payload.type,
							}),
						)
						const full =
							yield* sql`SELECT * FROM documents WHERE id = ${created.id} LIMIT 1`
						const doc = full[0]
						if (!doc)
							return yield* Effect.die(
								new Error('document vanished after insert'),
							)
						return yield* detailFor(doc, created.id)
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE documents SET ${sql.update({ ..._.payload, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })}
							WHERE id = ${_.params.id} RETURNING *
						`
						yield* Effect.logInfo('Document updated').pipe(
							Effect.annotateLogs({
								event: 'document.updated',
								documentId: _.params.id,
							}),
						)
						const row = rows[0]
						return row === undefined ? null : yield* detailFor(row, _.params.id)
					}).pipe(Effect.orDie),
				)
				.handle('remove', _ =>
					Effect.gen(function* () {
						// The links go with the row through their foreign key.
						yield* sql`DELETE FROM documents WHERE id = ${_.params.id}`
						yield* Effect.logInfo('Document removed').pipe(
							Effect.annotateLogs({
								event: 'document.removed',
								documentId: _.params.id,
							}),
						)
					}).pipe(Effect.orDie),
				)
				.handle('attach', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const linked = yield* linkDocument(
							sql,
							currentOrg.id,
							_.params.id,
							_.payload.subjectTable,
							_.payload.subjectId,
						)
						if (!linked)
							return yield* new NotFound({
								entity: _.payload.subjectTable,
								id: _.payload.subjectId,
							})
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('detach', _ =>
					unlinkDocument(
						sql,
						_.params.id,
						_.params.subjectTable as DocumentSubjectTable,
						_.params.subjectId,
					).pipe(Effect.asVoid),
				)
		}),
)

export type { DocumentSubjectRow }
