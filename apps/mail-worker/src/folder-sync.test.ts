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
import { TimelineActivityService } from '@batuda/timeline'

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

// A folder holding several messages, answered in uid order.
const clientWithAll = (uids: readonly number[]): ImapFlow =>
	({
		search: async () => [...uids],
		fetch: async function* () {
			for (const uid of uids) {
				yield { uid, source: Buffer.from('raw bytes') }
			}
		},
	}) as unknown as ImapFlow

// Makes exactly one message refuse to be taken in, the way a database error
// during ingest does.
const failingOn = (badUid: number) => {
	ingestMock.mockImplementation((a: { imapUid: number }) =>
		a.imapUid === badUid
			? (Effect.fail(new Error('ingest failed')) as never)
			: Effect.void,
	)
}

// Recording the folder head is the only database work in this path, and it is
// not what these tests are about. The matcher and the object store are named
// because storing a message asks for them, but it is stubbed out here, so
// nothing ever reaches them.
const stubs = Layer.mergeAll(
	Layer.succeed(SqlClient.SqlClient, (() => Effect.void) as never),
	Layer.succeed(ParticipantMatcher, {} as never),
	Layer.succeed(RawMessageStorage, {} as never),
	Layer.succeed(TimelineActivityService, {} as never),
)

const run = <A, E>(
	effect: Effect.Effect<
		A,
		E,
		| SqlClient.SqlClient
		| ParticipantMatcher
		| RawMessageStorage
		| TimelineActivityService
	>,
) => Effect.runPromise(effect.pipe(Effect.provide(stubs)))

const directionPassedToIngest = () => ingestMock.mock.calls[0]?.[0]?.direction

beforeEach(() => {
	ingestMock.mockClear()
	ingestMock.mockImplementation(() => Effect.void)
})

describe('how far a folder is read when a message will not load', () => {
	describe('when one message in the batch fails', () => {
		it('should leave the folder waiting on it rather than reading past', async () => {
			// GIVEN three new messages, the middle one of which cannot be taken in
			failingOn(6)

			// WHEN the folder is read
			const progress = await run(
				fetchAndIngestNewerThan({
					client: clientWithAll([5, 6, 7]),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: 'INBOX',
					direction: 'inbound',
					uidvalidity: 1,
					sinceUid: 4,
					stuckUid: null,
					attempts: 0,
				}),
			)

			// THEN it stops there and says so, so the next pass starts from that
			// message again. Reading past it would leave mail that landed nowhere
			// behind, and nothing would ever go looking for it
			expect(progress.lastUid).toBe(5)
			expect(progress.stuckUid).toBe(6)
			expect(progress.attempts).toBe(1)
		})

		it('should not read the ones behind it either', async () => {
			// GIVEN the same batch
			failingOn(6)

			// WHEN the folder is read
			await run(
				fetchAndIngestNewerThan({
					client: clientWithAll([5, 6, 7]),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: 'INBOX',
					direction: 'inbound',
					uidvalidity: 1,
					sinceUid: 4,
					stuckUid: null,
					attempts: 0,
				}),
			)

			// THEN the message after it waits for the next pass, so the folder is
			// read in order rather than around the gap
			expect(ingestMock.mock.calls.map(c => c[0].imapUid)).toEqual([5, 6])
		})
	})

	describe('when the same message has already failed several times', () => {
		it('should move on without it, loudly', async () => {
			// GIVEN a message that has failed four passes already
			failingOn(6)

			// WHEN a fifth pass tries it
			const progress = await run(
				fetchAndIngestNewerThan({
					client: clientWithAll([6, 7]),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: 'INBOX',
					direction: 'inbound',
					uidvalidity: 1,
					sinceUid: 5,
					stuckUid: 6,
					attempts: 4,
				}),
			)

			// THEN the folder gives up on it and carries on, because one message
			// nobody can read must not hold every message behind it
			expect(progress.stuckUid).toBeNull()
			expect(progress.attempts).toBe(0)
			expect(progress.lastUid).toBe(7)
			expect(ingestMock.mock.calls.map(c => c[0].imapUid)).toEqual([6, 7])
		})
	})

	describe('when a message that had been failing goes through', () => {
		it('should stop waiting on it', async () => {
			// GIVEN a message the folder has been waiting on, which now loads
			const progress = await run(
				fetchAndIngestNewerThan({
					client: clientWithAll([6]),
					organizationId: 'org',
					inboxId: 'inbox',
					folder: 'INBOX',
					direction: 'inbound',
					uidvalidity: 1,
					sinceUid: 5,
					stuckUid: 6,
					attempts: 3,
				}),
			)

			// THEN the count is cleared, so an earlier bad patch does not spend
			// the allowance of a message that is fine now
			expect(progress.stuckUid).toBeNull()
			expect(progress.attempts).toBe(0)
			expect(progress.lastUid).toBe(6)
		})
	})
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
					stuckUid: null,
					attempts: 0,
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
					stuckUid: null,
					attempts: 0,
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
