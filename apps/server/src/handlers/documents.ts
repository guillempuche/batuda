import { DateTime, Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg, NotFound } from '@batuda/controllers'
import { Document } from '@batuda/domain'

import { resolvePageTotal } from '../lib/sql-pagination'
import {
	DocumentCreated,
	TimelineActivityService,
} from '../services/timeline-activity'

const decodeDocument = Schema.decodeUnknownEffect(Document)
const decodeDocuments = Schema.decodeUnknownEffect(Schema.Array(Document))

export const DocumentsLive = HttpApiBuilder.group(
	BatudaApi,
	'documents',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const limit = _.query.limit ?? 100
						const offset = _.query.offset ?? 0
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						if (_.query.type) conditions.push(sql`type = ${_.query.type}`)
						const rows = yield* sql<{ readonly total: string | number }>`
							SELECT *, COUNT(*) OVER () AS total FROM documents
							WHERE ${sql.and(conditions)}
							LIMIT ${limit} OFFSET ${offset}
						`
						const total = yield* resolvePageTotal(
							rows,
							offset,
							() => sql<{ readonly count: string | number }>`
								SELECT count(*) AS count FROM documents
								WHERE ${sql.and(conditions)}
							`,
						)
						const items = yield* decodeDocuments(rows)
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
						return yield* decodeDocument(doc)
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const payload = _.payload as {
							companyId: string
							interactionId?: string
							type: string
							title?: string
							content: string
						}
						const rows = yield* sql<{ id: string; title: string | null }>`
							INSERT INTO documents ${sql.insert({
								...payload,
								organizationId: currentOrg.id,
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
								companyId: payload.companyId,
								contactId: null,
								title: created.title ?? payload.type,
								actorUserId: null,
								occurredAt: DateTime.toDateUtc(DateTime.nowUnsafe()),
							}),
						)
						yield* Effect.logInfo('Document created').pipe(
							Effect.annotateLogs({
								event: 'document.created',
								companyId: payload.companyId,
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
						return yield* decodeDocument(doc)
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
						return row === undefined ? null : yield* decodeDocument(row)
					}).pipe(Effect.orDie),
				)
		}),
)
