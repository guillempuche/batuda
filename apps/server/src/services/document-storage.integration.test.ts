import { randomUUID } from 'node:crypto'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { StorageError } from '@batuda/controllers'

import { PgLive } from '../db/client.js'
import {
	deleteStoredFile,
	rewriteStoredHtml,
	storedFileFor,
} from './documents.js'
import { StorageProvider } from './storage-provider.js'

// A web page's body is a file, not a column, and nothing in the database knows
// that. Two faults followed from it and are pinned here: deleting a document
// left its page in storage forever, and editing one wrote the new HTML onto the
// row while the stored page kept the old bytes, so the edit vanished with no
// error. Storage is stubbed, so these assert what the code asks of it rather
// than re-testing S3; the real path runs against MinIO in the API round trip.

const ORG = `docstore-${randomUUID()}`

const written: Array<{ key: string; body: string }> = []
const deleted: string[] = []

const storageStub = Layer.succeed(StorageProvider)(
	StorageProvider.of({
		put: params =>
			Effect.sync(() => {
				written.push({
					key: params.key,
					body: new TextDecoder().decode(params.body),
				})
			}),
		get: () => Effect.die('unused'),
		delete: key =>
			Effect.sync(() => {
				deleted.push(key)
			}),
		head: () => Effect.die('unused'),
		signedUrl: () => Effect.die('unused'),
	}),
)

const run = <A>(eff: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
	Effect.runPromise(
		eff.pipe(Effect.orDie, Effect.provide(PgLive)) as Effect.Effect<
			A,
			never,
			never
		>,
	)

const runWithStorage = <A>(
	eff: Effect.Effect<A, unknown, SqlClient.SqlClient | StorageProvider>,
) =>
	Effect.runPromise(
		eff.pipe(
			Effect.orDie,
			Effect.provide(storageStub),
			Effect.provide(PgLive),
		) as Effect.Effect<A, never, never>,
	)

const seedDocument = (format: 'markdown' | 'html') =>
	run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			const id = randomUUID()
			const storageKey =
				format === 'html' ? `documents/${ORG}/${id}.html` : null
			yield* sql`
				INSERT INTO documents (id, organization_id, type, format, content, storage_key, search_text)
				VALUES (
					${id}, ${ORG}, 'general', ${format},
					${format === 'html' ? '' : '# markdown body'},
					${storageKey},
					${format === 'html' ? 'old words' : null}
				)
			`
			return { id, storageKey }
		}),
	)

describe('a document whose body is a stored file', () => {
	beforeAll(() => {
		written.length = 0
		deleted.length = 0
	})

	afterAll(async () => {
		await run(
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`DELETE FROM documents WHERE organization_id = ${ORG}`
			}),
		)
	})

	describe('when asked where a document keeps its body', () => {
		it('should name the file for a web page and nothing for markdown', async () => {
			// GIVEN one document of each kind
			const html = await seedDocument('html')
			const markdown = await seedDocument('markdown')

			// WHEN each is asked where its body lives
			const forHtml = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* storedFileFor(sql, html.id)
				}),
			)
			const forMarkdown = await run(
				Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					return yield* storedFileFor(sql, markdown.id)
				}),
			)

			// THEN only the web page has one, which is what tells a caller whether
			// storage has to be touched at all
			expect(forHtml).toBe(html.storageKey)
			expect(forMarkdown).toBeNull()
		})
	})

	describe('when a web page is edited', () => {
		it('should write the new body where the page is read from, not onto the row', async () => {
			// GIVEN a stored page
			const html = await seedDocument('html')

			// WHEN it is edited
			const fields = await runWithStorage(
				Effect.gen(function* () {
					const storage = yield* StorageProvider
					return yield* rewriteStoredHtml(
						storage,
						html.storageKey!,
						'<html><body><h1>Second draft</h1></body></html>',
					)
				}),
			)

			// THEN the new bytes went to the file the page is served from
			expect(written.at(-1)?.key).toBe(html.storageKey)
			expect(written.at(-1)?.body).toContain('Second draft')
			// AND the row keeps no body of its own, so there is one answer to what
			// the page says
			expect(fields.content).toBe('')
			// AND the words a search matches on moved with it, or the page would
			// stay findable by wording it no longer contains
			expect(fields.searchText).toBe('Second draft')
		})
	})

	describe('when a document is deleted', () => {
		it('should take its stored page with it', async () => {
			// GIVEN a stored page
			const html = await seedDocument('html')

			// WHEN the document is deleted
			await runWithStorage(
				Effect.gen(function* () {
					const storage = yield* StorageProvider
					return yield* deleteStoredFile(storage, html.id, html.storageKey!)
				}),
			)

			// THEN the file goes too — otherwise the content of something somebody
			// deleted is still sitting in storage
			expect(deleted).toContain(html.storageKey)
		})

		it('should still count as deleted when storage refuses', async () => {
			// GIVEN storage that refuses the delete
			const failing = Layer.succeed(StorageProvider)(
				StorageProvider.of({
					put: () => Effect.die('unused'),
					get: () => Effect.die('unused'),
					delete: key =>
						Effect.fail(
							new StorageError({
								message: 'bucket unreachable',
								operation: 'delete',
								key,
							}),
						),
					head: () => Effect.die('unused'),
					signedUrl: () => Effect.die('unused'),
				}),
			)

			// WHEN a document is deleted anyway
			// THEN this resolves rather than raising: an unreachable file is worth
			// less than a document somebody cannot get rid of
			await Effect.runPromise(
				Effect.gen(function* () {
					const storage = yield* StorageProvider
					return yield* deleteStoredFile(storage, 'some-id', 'some/key.html')
				}).pipe(Effect.provide(failing)) as Effect.Effect<
					unknown,
					never,
					never
				>,
			)
		})
	})
})
