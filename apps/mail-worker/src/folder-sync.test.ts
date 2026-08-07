// Which way a message went is decided once, from the folder it was read from,
// and then carried down through the sync. These pin the carrying: the decision
// is made in inbox-session, acted on in persist, and everything between only
// passes it along — where a wrong hand-off is invisible until mail is filed
// backwards in production.

import { Buffer } from 'node:buffer'

import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/unstable/sql'
import type { ImapFlow } from 'imapflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ParticipantMatcher } from '@batuda/email/participant-matcher'

import { ingestRawMessage } from './ingest.js'
import { RawMessageStorage } from './storage.js'

vi.mock('./ingest.js', () => ({
	ingestRawMessage: vi.fn(() => Effect.void),
}))

const { backfillSinceDate } = await import('./backfill.js')
const { fetchAndIngestNewerThan } = await import('./folder-sync.js')

const ingestMock = vi.mocked(ingestRawMessage)

// Only the two calls these functions make, answering with one message.
const clientWith = (uid: number): ImapFlow =>
	({
		search: async () => [uid],
		fetch: async function* () {
			yield { uid, source: Buffer.from('raw bytes') }
		},
	}) as unknown as ImapFlow

// Recording the folder head is the only database work in this path, and it is
// not what these tests are about. The matcher and the object store are named
// because storing a message asks for them, but it is stubbed out here, so
// nothing ever reaches them.
const stubs = Layer.mergeAll(
	Layer.succeed(SqlClient.SqlClient, (() => Effect.void) as never),
	Layer.succeed(ParticipantMatcher, {} as never),
	Layer.succeed(RawMessageStorage, {} as never),
)

const run = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		SqlClient.SqlClient | ParticipantMatcher | RawMessageStorage
	>,
) => Effect.runPromise(effect.pipe(Effect.provide(stubs)))

const directionPassedToIngest = () => ingestMock.mock.calls[0]?.[0]?.direction

beforeEach(() => {
	ingestMock.mockClear()
})

describe('fetchAndIngestNewerThan', () => {
	describe('when reading a folder holding mail we sent', () => {
		it('should carry that down to where the message is stored', async () => {
			// GIVEN one new message in a folder the caller has settled as outbound
			// WHEN it is taken in
			await run(
				fetchAndIngestNewerThan({
					client: clientWith(7),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: '[Gmail]/Sent Mail',
					direction: 'outbound',
					uidvalidity: 1,
					sinceUid: 6,
				}),
			)

			// THEN the message is stored as one we sent
			expect(ingestMock).toHaveBeenCalledOnce()
			expect(directionPassedToIngest()).toBe('outbound')
		})
	})

	describe('when reading a folder holding mail that arrived', () => {
		it('should carry that down unchanged', async () => {
			// GIVEN one new message in a folder settled as inbound
			// WHEN it is taken in
			await run(
				fetchAndIngestNewerThan({
					client: clientWith(3),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: 'INBOX',
					direction: 'inbound',
					uidvalidity: 1,
					sinceUid: 2,
				}),
			)

			// THEN it is stored as mail that arrived
			expect(directionPassedToIngest()).toBe('inbound')
		})
	})
})

describe('backfillSinceDate', () => {
	describe('when first reading a folder holding mail we sent', () => {
		it('should carry that down too', async () => {
			// GIVEN a folder being read for the first time — a different path into
			// the same store, and the one a newly connected mailbox takes
			// WHEN its recent messages are taken in
			await run(
				backfillSinceDate({
					client: clientWith(11),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: 'Sent Items',
					direction: 'outbound',
					uidvalidity: 1,
					sinceDate: new Date('2026-01-01T00:00:00Z'),
				}),
			)

			// THEN those messages are stored as ones we sent
			expect(ingestMock).toHaveBeenCalledOnce()
			expect(directionPassedToIngest()).toBe('outbound')
		})
	})
})
