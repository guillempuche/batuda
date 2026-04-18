import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { ForjaApi, NotFound } from '@engranatge/controllers'

import {
	DocumentCreated,
	TimelineActivityService,
} from '../services/timeline-activity'

export const DocumentsLive = HttpApiBuilder.group(
	ForjaApi,
	'documents',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const timeline = yield* TimelineActivityService
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`company_id = ${_.query.companyId}`)
						if (_.query.type) conditions.push(sql`type = ${_.query.type}`)
						return yield* sql`SELECT * FROM documents WHERE ${sql.and(conditions)}`
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
						return doc
					}).pipe(
						Effect.catch(e =>
							e._tag === 'NotFound' ? Effect.fail(e) : Effect.die(e),
						),
					),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const payload = _.payload as {
							companyId: string
							interactionId?: string
							type: string
							title?: string
							content: string
						}
						const rows = yield* sql<{ id: string; title: string | null }>`
							INSERT INTO documents ${sql.insert(payload)} RETURNING id, title
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
								occurredAt: new Date(),
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
						return full[0]
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const rows = yield* sql`
							UPDATE documents SET ${sql.update({ ...(_.payload as any), updatedAt: new Date() }, ['id'])}
							WHERE id = ${_.params.id} RETURNING *
						`
						yield* Effect.logInfo('Document updated').pipe(
							Effect.annotateLogs({
								event: 'document.updated',
								documentId: _.params.id,
							}),
						)
						return rows[0]
					}).pipe(Effect.orDie),
				)
		}),
)
