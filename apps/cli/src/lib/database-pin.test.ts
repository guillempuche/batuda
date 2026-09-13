import { describe, expect, it } from 'vitest'

import { databasePinMismatch } from './database-pin'

const worktree = 'postgresql://batuda:secret@localhost:5433/batuda_tooling'
const other = 'postgresql://batuda:secret@localhost:5433/batuda_main'

describe('databasePinMismatch', () => {
	describe('when both sides name the same database', () => {
		it('should let the pass go ahead', () => {
			// GIVEN an exported connection string equal to the one in .env
			// WHEN the two are compared
			// THEN there is nothing to refuse
			expect(databasePinMismatch(worktree, worktree)).toBeNull()
		})

		it.each([
			[
				'the standard port is left out on one side',
				'postgresql://batuda:secret@localhost/batuda_tooling',
				'postgresql://batuda:secret@localhost:5432/batuda_tooling',
			],
			[
				'one side names the loopback address',
				'postgresql://batuda:secret@127.0.0.1:5433/batuda_tooling',
				worktree,
			],
		])('should let the pass go ahead when %s', (_case, callerUrl, fileUrl) => {
			// GIVEN two spellings of one database
			// WHEN the two are compared
			// THEN nothing is refused over a difference that reaches the same rows
			expect(databasePinMismatch(callerUrl, fileUrl)).toBeNull()
		})

		it('should ignore a difference that is only in the credentials', () => {
			// GIVEN the same host, port and database reached with another password
			const sameDatabase =
				'postgresql://batuda:other-password@localhost:5433/batuda_tooling'

			// WHEN the two are compared
			// THEN the pass goes ahead: it is the same data either way
			expect(databasePinMismatch(sameDatabase, worktree)).toBeNull()
		})
	})

	describe('when the sides name different databases', () => {
		it('should report both, without their passwords', () => {
			// GIVEN an environment pointing at another worktree's database
			// WHEN the two are compared
			const mismatch = databasePinMismatch(other, worktree)

			// THEN both are named as host, port and database alone
			expect(mismatch).toStrictEqual({
				caller: 'localhost:5433/batuda_main',
				file: 'localhost:5433/batuda_tooling',
			})
			expect(JSON.stringify(mismatch)).not.toContain('secret')
		})

		it.each([
			[
				'a different host',
				'postgresql://u:p@db.example.com:5433/batuda_tooling',
				'db.example.com:5433/batuda_tooling',
			],
			[
				'a different port',
				'postgresql://u:p@localhost:5432/batuda_tooling',
				'localhost:5432/batuda_tooling',
			],
		])('should report %s', (_case, callerUrl, expected) => {
			// GIVEN an exported string differing from .env in one part
			// WHEN the two are compared
			// THEN that part is enough to refuse the pass
			expect(databasePinMismatch(callerUrl, worktree)?.caller).toBe(expected)
		})
	})

	describe('when there is nothing to compare', () => {
		it.each([
			['the caller exported nothing', undefined, worktree],
			['the caller exported a blank value', '', worktree],
			['this checkout has no .env', worktree, undefined],
			['the .env names no database', worktree, ''],
		])('should let the pass go ahead when %s', (_case, callerUrl, fileUrl) => {
			// GIVEN only one side names a database
			// WHEN the two are compared
			// THEN there is no pin to hold the pass to
			expect(databasePinMismatch(callerUrl, fileUrl)).toBeNull()
		})
	})

	describe('when a connection string cannot be read', () => {
		it('should refuse rather than guess', () => {
			// GIVEN an exported value that is not a connection string at all
			// WHEN the two are compared
			const mismatch = databasePinMismatch('not-a-url', worktree)

			// THEN it is called unreadable and the pass stops
			expect(mismatch).toStrictEqual({
				caller: 'unreadable',
				file: 'localhost:5433/batuda_tooling',
			})
		})

		it('should refuse when neither side can be read either', () => {
			// GIVEN two values that both fail to parse
			// WHEN the two are compared
			const mismatch = databasePinMismatch('not-a-url', 'also-not-a-url')

			// THEN the pass stops rather than proceed on two strings nothing can read
			expect(mismatch).toStrictEqual({
				caller: 'unreadable',
				file: 'unreadable',
			})
		})

		it('should refuse when only the file cannot be read', () => {
			// GIVEN a readable exported string and an .env value that is not one
			// WHEN the two are compared
			// THEN the pass stops, naming the side that could not be read
			expect(databasePinMismatch(worktree, 'not-a-url')).toStrictEqual({
				caller: 'localhost:5433/batuda_tooling',
				file: 'unreadable',
			})
		})
	})
})
