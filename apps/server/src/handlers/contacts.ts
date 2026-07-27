import { DateTime, Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg } from '@batuda/controllers'
import { Contact, ContactChannel } from '@batuda/domain'

import {
	pageOf,
	probeLimit,
	resolveTotal,
	takePage,
	totalColumn,
} from '../lib/sql-pagination'
import {
	addChannel,
	channelsOf,
	clearEmailSuppression,
	contactChannelsJson,
	deleteChannel,
	patchChannel,
	writeChannels,
} from '../services/contact-channels'
import { unlinkSubject } from '../services/documents'

const decodeContact = Schema.decodeUnknownEffect(Contact)
const decodeChannel = Schema.decodeUnknownEffect(ContactChannel)
const decodeChannels = Schema.decodeUnknownEffect(Schema.Array(ContactChannel))

export const ContactsLive = HttpApiBuilder.group(
	BatudaApi,
	'contacts',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const page = pageOf(_.query, 100)
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`c.company_id = ${_.query.companyId}`)
						// `provenance` traces a contact back to the research runs that
						// wrote it and the sources those runs cited, so the reader can
						// tell a researched contact from a hand-entered one. Row-level
						// security limits the linked runs to the caller's org; how the
						// trail is worded is left to the presentation layer.
						const probed = yield* sql`
							SELECT c.*, ${contactChannelsJson(sql)} AS channels,
							COALESCE((
								SELECT json_agg(json_build_object(
									'runId', rl.research_id,
									'runCompletedAt', r.completed_at,
									'sources', COALESCE((
										SELECT json_agg(json_build_object('sourceId', s.id, 'url', s.url))
										FROM jsonb_array_elements(rl.citations) cit
										JOIN sources s ON s.id = cit->>'source_id'
									), '[]'::json)
								) ORDER BY r.completed_at DESC NULLS LAST)
								FROM research_links rl
								JOIN research_runs r ON r.id = rl.research_id
								WHERE rl.subject_table = 'contacts' AND rl.subject_id = c.id
							), '[]'::json) AS provenance
							${totalColumn(sql, page.count)}
							FROM contacts c
							WHERE ${sql.and(conditions)}
							ORDER BY c.name
							LIMIT ${probeLimit(page.limit)} OFFSET ${page.offset}
						`
						const { rows, hasMore } = takePage(probed, page.limit)
						const total = yield* resolveTotal(
							page,
							rows as ReadonlyArray<{ readonly total?: string | number }>,
							() => sql<{ readonly count: string | number }>`
								SELECT count(*) AS count FROM contacts c
								WHERE ${sql.and(conditions)}
							`,
						)
						// Decode each contact's own columns; `channels` and `provenance`
						// are already JSON from the aggregates, so keep them as-is.
						const items = yield* Effect.forEach(rows, row =>
							decodeContact(row).pipe(
								Effect.map(c => ({
									...c,
									channels: (
										row as { readonly channels: ReadonlyArray<unknown> }
									).channels,
									provenance: (
										row as { readonly provenance: ReadonlyArray<unknown> }
									).provenance,
								})),
							),
						)
						return {
							items,
							total,
							limit: page.limit,
							offset: page.offset,
							hasMore,
						}
					}).pipe(Effect.orDie),
				)
				.handle('create', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const { channels, ...fields } = _.payload
						const rows = yield* sql`INSERT INTO contacts ${sql.insert({
							...fields,
							organizationId: currentOrg.id,
						})} RETURNING *`
						const contact = rows[0] as { id: string }
						if (channels && channels.length > 0)
							yield* writeChannels(sql, currentOrg.id, contact.id, channels)
						const ch = yield* channelsOf(sql, contact.id)
						yield* Effect.logInfo('Contact created').pipe(
							Effect.annotateLogs({
								event: 'contact.created',
								companyId: _.payload.companyId,
							}),
						)
						const decoded = yield* decodeContact(rows[0])
						const decodedChannels = yield* decodeChannels(ch)
						return { ...decoded, channels: decodedChannels }
					}).pipe(Effect.orDie),
				)
				.handle('update', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						const { channels, ...fields } = _.payload
						const rows = yield* sql`
							UPDATE contacts SET ${sql.update({ ...fields, updatedAt: DateTime.toDateUtc(DateTime.nowUnsafe()) })}
							WHERE id = ${_.params.id} RETURNING *
						`
						if (channels && channels.length > 0)
							yield* writeChannels(sql, currentOrg.id, _.params.id, channels)
						const ch = yield* channelsOf(sql, _.params.id)
						yield* Effect.logInfo('Contact updated').pipe(
							Effect.annotateLogs({
								event: 'contact.updated',
								contactId: _.params.id,
							}),
						)
						const decoded = yield* decodeContact(rows[0])
						const decodedChannels = yield* decodeChannels(ch)
						return { ...decoded, channels: decodedChannels }
					}).pipe(Effect.orDie),
				)
				.handle('remove', _ =>
					Effect.gen(function* () {
						// No foreign key clears these, so they would outlive the
						// person and point at nobody.
						yield* unlinkSubject(sql, 'contacts', _.params.id)
						yield* sql`DELETE FROM contacts WHERE id = ${_.params.id}`
						yield* Effect.logInfo('Contact removed').pipe(
							Effect.annotateLogs({
								event: 'contact.removed',
								contactId: _.params.id,
							}),
						)
					}).pipe(Effect.orDie),
				)
				.handle('addChannel', _ =>
					Effect.gen(function* () {
						const currentOrg = yield* CurrentOrg
						return yield* addChannel(
							sql,
							currentOrg.id,
							_.params.id,
							_.payload,
						).pipe(Effect.flatMap(decodeChannel))
					}).pipe(Effect.orDie),
				)
				.handle('updateChannel', _ =>
					patchChannel(sql, _.params.channelId, _.payload).pipe(
						Effect.flatMap(decodeChannel),
						Effect.orDie,
					),
				)
				.handle('deleteChannel', _ =>
					Effect.gen(function* () {
						yield* deleteChannel(sql, _.params.channelId)
					}).pipe(Effect.orDie),
				)
				.handle('clearSuppression', _ =>
					Effect.gen(function* () {
						yield* clearEmailSuppression(sql, _.params.id)
						const ch = yield* channelsOf(sql, _.params.id)
						yield* Effect.logInfo('Contact suppression cleared').pipe(
							Effect.annotateLogs({
								event: 'contact.suppression_cleared',
								contactId: _.params.id,
							}),
						)
						const decodedChannels = yield* decodeChannels(ch)
						return { id: _.params.id, channels: decodedChannels }
					}).pipe(Effect.orDie),
				)
		}),
)
