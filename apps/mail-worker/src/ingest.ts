import { Buffer } from 'node:buffer'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { simpleParser } from 'mailparser'

import { applyBounce, parseBounce } from './bounces.js'
import {
	type AttachmentMetadata,
	fromParsedMail,
	persistInboundMessage,
} from './persist.js'
import { attachmentKey, RawMessageStorage, rawMessageKey } from './storage.js'

// One transactional ingest step per fetched UID. Wraps:
//  1. mailparser.simpleParser → ParsedMail
//  2. DSN check → applyBounce when present (still continues to step 4)
//  3. R2 PUT of the raw RFC822 (idempotent on the deterministic key)
//  4. R2 PUT of each parsed attachment as its own object so the read
//     path is a single GET, not a parse-on-demand.
//  5. INSERT email_messages + participants + thread link, carrying
//     `attachments` JSONB metadata that points at the keys from step 4.
//
// SET LOCAL app.current_org_id pins the GUC for the surrounding TX so
// any future SELECT from app_user code paths keeps to a single org.
// We connect as app_service (BYPASSRLS), so the GUC is informational
// here, but matters for later observability / cross-worker debugging.
export const ingestRawMessage = (args: {
	readonly organizationId: string
	readonly inboxId: string
	readonly folder: string
	readonly imapUid: number
	readonly imapUidvalidity: number
	readonly raw: Uint8Array
}) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const storage = yield* RawMessageStorage

		const mail = yield* Effect.promise(() =>
			simpleParser(Buffer.from(args.raw)),
		)

		const key = rawMessageKey({
			organizationId: args.organizationId,
			inboxId: args.inboxId,
			uidValidity: args.imapUidvalidity,
			uid: args.imapUid,
		})
		yield* storage
			.putRaw(key, args.raw)
			.pipe(Effect.mapError(err => new Error(String(err))))

		// Upload each parsed attachment as its own object before the SQL
		// INSERT. If a put fails the gen short-circuits, the message is
		// not inserted, and the next worker tick re-runs the same UID
		// (idempotent on the deterministic key + the partial unique
		// dedupe index). Result: never persist a row whose attachments
		// JSONB references missing bytes.
		const attachmentsMeta: AttachmentMetadata[] = []
		for (let i = 0; i < mail.attachments.length; i++) {
			const a = mail.attachments[i]!
			const aKey = attachmentKey({
				organizationId: args.organizationId,
				inboxId: args.inboxId,
				uidValidity: args.imapUidvalidity,
				uid: args.imapUid,
				index: i,
			})
			yield* storage
				.putAttachment(aKey, a.content, a.contentType)
				.pipe(Effect.mapError(err => new Error(String(err))))
			attachmentsMeta.push({
				index: i,
				filename: a.filename ?? `attachment-${i}`,
				contentType: a.contentType,
				sizeBytes: a.size,
				cid: a.cid ?? null,
				isInline: a.contentDisposition === 'inline',
				storageKey: aKey,
			})
		}

		const parsed = fromParsedMail(mail)

		yield* sql.withTransaction(
			Effect.gen(function* () {
				// Worker connects as the DATABASE_URL owner (superuser); the
				// explicit SET LOCAL ROLE pins the per-tx identity to
				// app_service (BYPASSRLS by design — the worker resolves the
				// org explicitly per row instead of relying on the request
				// path's RLS policies). Pairs with set_config('app.current_org_id'),
				// which still fires for audit-trail consistency.
				yield* sql`SET LOCAL ROLE app_service`
				yield* sql`SELECT set_config('app.current_org_id', ${args.organizationId}, true)`

				// Bounce check first: a DSN both updates the original message
				// status AND gets persisted as its own inbound row so the user
				// sees "Mail Delivery Subsystem" in the inbox list.
				const bounce = parseBounce(mail)
				if (bounce) {
					yield* applyBounce({
						organizationId: args.organizationId,
						bounce,
					})
				}

				yield* persistInboundMessage({
					organizationId: args.organizationId,
					inboxId: args.inboxId,
					folder: args.folder,
					imapUid: args.imapUid,
					imapUidvalidity: args.imapUidvalidity,
					rawRfc822Ref: key,
					parsed,
					attachments: attachmentsMeta,
				})
			}),
		)
	})
