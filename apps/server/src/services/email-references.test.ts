import { describe, expect, it } from 'vitest'

import { buildReferences } from './email'

// The References header is how a mail client hangs a reply under the message it
// answers. Two things have to hold at once: the last entry must be the message
// being answered, and the id the conversation is filed under must be somewhere
// in the list, because that is how this system finds a message's conversation
// again. Getting the first wrong scrambles the reader's view; getting the
// second wrong makes our own messages vanish from the thread.

const ROOT = '<root@client.test>'
const PARENT = '<parent@client.test>'

describe('buildReferences', () => {
	describe('when the conversation starts where we do', () => {
		it('should list the first message first and the answered one last', () => {
			// GIVEN a parent whose own chain starts at the root
			// WHEN the header is built
			// THEN it reads oldest to newest
			expect(
				buildReferences({
					root: ROOT,
					parentReferences: [ROOT, '<mid@client.test>'],
					parentMessageId: PARENT,
				}),
			).toEqual([ROOT, '<mid@client.test>', PARENT])
		})

		it('should name a single message once when it is the whole conversation', () => {
			// GIVEN a conversation holding only its first message
			// WHEN a reply answers it
			// THEN that id appears once, not twice
			expect(
				buildReferences({
					root: ROOT,
					parentReferences: [],
					parentMessageId: ROOT,
				}),
			).toEqual([ROOT])
		})
	})

	describe('when we joined the conversation midway', () => {
		it('should keep the answered message last rather than hoisting it', () => {
			// GIVEN a conversation we were copied into: the first message we hold
			// is itself a reply, so it becomes the id we file under while
			// carrying older ancestors we never saw
			// WHEN a reply is built
			// THEN the ancestors stay in front and the answered message stays last
			// AND putting the filed-under id first here would tell the reader the
			// newest message is the oldest
			expect(
				buildReferences({
					root: '<D@client.test>',
					parentReferences: [
						'<A@client.test>',
						'<B@client.test>',
						'<C@client.test>',
					],
					parentMessageId: '<D@client.test>',
				}),
			).toEqual([
				'<A@client.test>',
				'<B@client.test>',
				'<C@client.test>',
				'<D@client.test>',
			])
		})

		it('should stay stable when its own output is fed back in', () => {
			// GIVEN the chain a first reply sent, now stored on that reply's row
			const first = buildReferences({
				root: '<D@client.test>',
				parentReferences: ['<A@client.test>', '<B@client.test>'],
				parentMessageId: '<D@client.test>',
			})

			// WHEN a second reply answers that first one
			const second = buildReferences({
				root: '<D@client.test>',
				parentReferences: first,
				parentMessageId: '<reply-1@taller.test>',
			})

			// THEN the earlier order is preserved and only the new message is added
			// AND nothing is re-hoisted on each round
			expect(second).toEqual([
				'<A@client.test>',
				'<B@client.test>',
				'<D@client.test>',
				'<reply-1@taller.test>',
			])
		})
	})

	describe('when the parent chain is untidy', () => {
		it('should drop repeats, keeping the earliest place each id appeared', () => {
			// GIVEN an id repeated in the parent's chain
			// WHEN the header is built
			// THEN it appears once
			expect(
				buildReferences({
					root: ROOT,
					parentReferences: [ROOT, ROOT, '<mid@client.test>'],
					parentMessageId: PARENT,
				}),
			).toEqual([ROOT, '<mid@client.test>', PARENT])
		})

		it('should move a parent that names itself to the end', () => {
			// GIVEN a parent whose own chain already includes its own id, which
			// some mailing-list software emits
			// WHEN the header is built
			// THEN it is answered last rather than left mid-list
			expect(
				buildReferences({
					root: ROOT,
					parentReferences: [ROOT, PARENT],
					parentMessageId: PARENT,
				}),
			).toEqual([ROOT, PARENT])
		})

		it('should drop entries that are not usable ids', () => {
			// GIVEN blanks and nulls, which the column this is read from allows
			// WHEN the header is built
			// THEN none of them reach it
			// AND a null would otherwise be written out as the word "null"
			expect(
				buildReferences({
					root: ROOT,
					parentReferences: [
						'',
						'   ',
						null as unknown as string,
						undefined as unknown as string,
					],
					parentMessageId: PARENT,
				}),
			).toEqual([ROOT, PARENT])
		})

		it('should add the filed-under id when the parent never carried it', () => {
			// GIVEN a parent chain with no trace of the conversation's own id
			// WHEN the header is built
			// THEN it is put in front, so the conversation stays findable
			expect(
				buildReferences({
					root: ROOT,
					parentReferences: ['<stranger@elsewhere.test>'],
					parentMessageId: PARENT,
				}),
			).toEqual([ROOT, '<stranger@elsewhere.test>', PARENT])
		})
	})

	describe('when the conversation is longer than a header should carry', () => {
		const chainOf = (n: number) =>
			Array.from({ length: n }, (_, i) => `<m${i}@client.test>`)

		it('should send a long chain whole while it still fits', () => {
			// GIVEN a chain exactly at the limit
			// WHEN the header is built
			// THEN nothing is dropped
			const refs = [ROOT, ...chainOf(18)]
			const built = buildReferences({
				root: ROOT,
				parentReferences: refs,
				parentMessageId: PARENT,
			})
			expect(built).toHaveLength(20)
			expect(built.at(-1)).toBe(PARENT)
		})

		it('should keep the newest links and the answered message', () => {
			// GIVEN a conversation far past the limit
			const built = buildReferences({
				root: ROOT,
				parentReferences: [ROOT, ...chainOf(60)],
				parentMessageId: PARENT,
			})

			// THEN the header is bounded
			expect(built).toHaveLength(20)
			// AND still answers the right message
			expect(built.at(-1)).toBe(PARENT)
			// AND the oldest links are the ones given up
			expect(built).not.toContain('<m0@client.test>')
			expect(built).toContain('<m59@client.test>')
		})

		it('should keep the filed-under id even when it is the oldest thing left', () => {
			// GIVEN a conversation long enough that the first message falls
			// outside the window of newest links
			const built = buildReferences({
				root: ROOT,
				parentReferences: [ROOT, ...chainOf(60)],
				parentMessageId: PARENT,
			})

			// THEN it is kept anyway, and kept in front
			// AND without it our own message stops being findable in its own
			// conversation, because that id is what the lookup searches for
			expect(built[0]).toBe(ROOT)
			expect(built).toContain(ROOT)
		})

		it('should not grow one entry longer on every reply', () => {
			// GIVEN a chain already at the limit
			let refs = buildReferences({
				root: ROOT,
				parentReferences: [ROOT, ...chainOf(60)],
				parentMessageId: PARENT,
			})

			// WHEN five more replies are sent on it
			for (let i = 0; i < 5; i++) {
				refs = buildReferences({
					root: ROOT,
					parentReferences: refs,
					parentMessageId: `<later-${i}@taller.test>`,
				})
				// THEN it stays bounded, keeps the filed-under id, and answers
				// the newest message each time
				expect(refs).toHaveLength(20)
				expect(refs[0]).toBe(ROOT)
				expect(refs.at(-1)).toBe(`<later-${i}@taller.test>`)
			}
		})
	})
})
