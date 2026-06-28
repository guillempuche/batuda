import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { Statement } from 'effect/unstable/sql'
import { SqlClient } from 'effect/unstable/sql'

import { BatudaApi, CurrentOrg } from '@batuda/controllers'

import {
	addChannel,
	channelsOf,
	clearEmailSuppression,
	deleteChannel,
	patchChannel,
	writeChannels,
} from '../services/contact-channels'

export const ContactsLive = HttpApiBuilder.group(
	BatudaApi,
	'contacts',
	handlers =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return handlers
				.handle('list', _ =>
					Effect.gen(function* () {
						const conditions: Array<Statement.Fragment> = []
						if (_.query.companyId)
							conditions.push(sql`c.company_id = ${_.query.companyId}`)
						return yield* sql`
							SELECT c.*, COALESCE(
								(SELECT json_agg(ch ORDER BY ch.is_primary DESC, ch.kind)
								 FROM contact_channels ch WHERE ch.contact_id = c.id),
								'[]'::json
							) AS channels
							FROM contacts c
							WHERE ${sql.and(conditions)}
							ORDER BY c.name
						`
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
						return { ...rows[0], channels: ch }
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
						return { ...rows[0], channels: ch }
					}).pipe(Effect.orDie),
				)
				.handle('remove', _ =>
					Effect.gen(function* () {
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
						return yield* addChannel(sql, currentOrg.id, _.params.id, _.payload)
					}).pipe(Effect.orDie),
				)
				.handle('updateChannel', _ =>
					patchChannel(sql, _.params.channelId, _.payload).pipe(Effect.orDie),
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
						return { id: _.params.id, channels: ch }
					}).pipe(Effect.orDie),
				)
		}),
)
