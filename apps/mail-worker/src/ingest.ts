import { Buffer } from 'node:buffer'

import { Effect } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { simpleParser } from 'mailparser'

import { applyBounce, parseBounce } from './bounces.js'
import { fromParsedMail, persistInboundMessage } from './persist.js'
import { RawMessageStorage, rawMessageKey } from './storage.js'

// One transactional ingest step per fetched UID. Wraps:
//  1. mailparser.simpleParser → ParsedMail
//  2. DSN check → applyBounce when present (still continues to step 4)
//  3. R2 PUT of the raw RFC822 (idempotent on the deterministic key)
//  4. INSERT email_messages + participants + thread link
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

		const parsed = fromParsedMail(mail)

		yield* sql.withTransaction(
			Effect.gen(function* () {
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
				})
			}),
		)
	})
