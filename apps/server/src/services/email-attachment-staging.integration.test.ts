// Covers statements the database refuses inside the request's own transaction,
// in the places that carry on afterwards and commit: an upload answered with a
// 400, and the cleanups after a send or a draft deletion, whose failure the
// caller ignores. A statement
// Postgres refused has already aborted that transaction, so without its own
// savepoint the commit failed — a bad upload came back as a 500, and so did a
// send whose mail had already gone.
//
// Prereq: `pnpm cli services up` — this suite's globalSetup builds and migrates
// the disposable batuda_it database it runs against.

import { Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, it } from 'vitest'

import { PgLive } from '../db/client'
import { enterOrgScope } from '../middleware/org'
import { applyTestEnv } from '../test-env'
import { EmailAttachmentStaging } from './email-attachment-staging'
import { StorageProvider } from './storage-provider'

applyTestEnv()

const org = {
	id: 'staging-refusal-test-org',
	name: 'Staging Refusal Test',
	slug: 'staging-refusal-test',
}

// Which stored objects were taken back after the row was refused.
const deletedKeys: Array<string> = []

const storageStub = Layer.succeed(StorageProvider, {
	put: () => Effect.void,
	delete: (key: string) =>
		Effect.sync(() => {
			deletedKeys.push(key)
		}),
	signedUrl: () => Effect.succeed('https://storage.test/signed'),
} as never)

const StagingLive = EmailAttachmentStaging.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(PgLive, storageStub)),
)

describe('EmailAttachmentStaging', () => {
	describe('when an upload names an inbox that is not an id the database can read', () => {
		it('should answer the refusal and still let the request commit', async () => {
			deletedKeys.length = 0

			// GIVEN an upload for an inbox address that is not a uuid, staged inside
			// the request's transaction with the refusal answered, as the upload
			// endpoint does
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const staging = yield* EmailAttachmentStaging
					return yield* enterOrgScope(sql, { org })(
						staging
							.stage({
								inboxId: 'not-a-uuid',
								bytes: new Uint8Array([1, 2, 3]),
								filename: 'notes.txt',
								contentType: 'text/plain',
								isInline: false,
							})
							.pipe(
								Effect.catchTag('BadRequest', refusal =>
									Effect.succeed(refusal.message),
								),
							),
					)
				}).pipe(Effect.provide(StagingLive)),
			)

			// WHEN the transaction commits
			// THEN the caller gets the refusal, not a failed commit, and the object
			// already stored for it is taken back
			expect(exit).toEqual(Exit.succeed('Failed to persist staging row'))
			expect(deletedKeys).toHaveLength(1)
		})
	})

	describe('when a statement in the cleanup after a send is refused', () => {
		it('should still let the send commit', async () => {
			// GIVEN a send's cleanup asked to purge an id Postgres refuses (text
			// may not carry a NUL), run inside the request's transaction with its
			// failure ignored, as every send does
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const staging = yield* EmailAttachmentStaging
					return yield* enterOrgScope(sql, { org })(
						staging
							.markSentAndCleanup(['stg_\u0000'])
							.pipe(Effect.ignore, Effect.as('sent')),
					)
				}).pipe(Effect.provide(StagingLive)),
			)

			// WHEN the transaction commits
			// THEN the send still answers as sent, rather than as a failure that
			// would have the client send the mail again
			expect(exit).toEqual(Exit.succeed('sent'))
		})
	})

	describe('when a statement in the cleanup after deleting a draft is refused', () => {
		it('should still let the deletion commit', async () => {
			// GIVEN a draft's attachment sweep for an id Postgres refuses (text may
			// not carry a NUL), run inside the request's transaction with its
			// failure ignored, as deleting a draft does
			const exit = await Effect.runPromiseExit(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const staging = yield* EmailAttachmentStaging
					return yield* enterOrgScope(sql, { org })(
						staging
							.sweepForDraft('draft_\u0000')
							.pipe(Effect.ignore, Effect.as('deleted')),
					)
				}).pipe(Effect.provide(StagingLive)),
			)

			// WHEN the transaction commits
			// THEN the deletion goes through rather than failing at the commit
			expect(exit).toEqual(Exit.succeed('deleted'))
		})
	})
})
