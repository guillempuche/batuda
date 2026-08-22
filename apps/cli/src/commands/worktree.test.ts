import { describe, expect, it } from 'vitest'

import { mergedPullRequestIn, repositoryNameIn } from './worktree'

// The two readings that decide whether a branch may be deleted by asking GitHub
// rather than by comparing diffs.
//
// Deleting a branch is the one step in a teardown nobody can undo, and every
// other reading it stands on compares diffs — which stop matching as soon as main
// gains a commit touching the same files, however plainly the work was merged. So
// these two are what keep the refusal from firing on a branch that went in an
// hour ago, and they are worth being able to read without a network.

describe('repositoryNameIn', () => {
	describe('when a checkout was cloned from GitHub', () => {
		it('should read the same name off either address git clones from', () => {
			// GIVEN the two addresses a clone comes from, with and without the ".git"
			// some of them carry
			// WHEN each is read
			// THEN the same repository either way, so which address somebody cloned
			// from cannot decide whether their branch is safe to delete
			for (const address of [
				'https://github.com/guillempuche/batuda.git',
				'https://github.com/guillempuche/batuda',
				'git@github.com:guillempuche/batuda.git',
				'git@github.com:guillempuche/batuda',
				'  https://github.com/guillempuche/batuda.git/  ',
			] as const) {
				expect(repositoryNameIn(address)).toBe('guillempuche/batuda')
			}
		})
	})

	describe('when the address names no GitHub repository', () => {
		it('should read nothing rather than guess', () => {
			// GIVEN a remote somewhere else, and one that is not an address at all
			// WHEN each is read
			// THEN nothing. Guessing here would send the question to the wrong
			// repository, and an answer from the wrong repository is worse than none
			for (const address of [
				'https://gitlab.com/guillempuche/batuda.git',
				'/srv/git/batuda.git',
				'',
			] as const) {
				expect(repositoryNameIn(address)).toBeNull()
			}
		})
	})
})

describe('mergedPullRequestIn', () => {
	describe('when GitHub names a merged pull request', () => {
		it('should read its number', () => {
			// GIVEN what `gh` prints when the branch was merged
			// WHEN read — THEN the number, which is enough to say the work is on main
			expect(mergedPullRequestIn('[{"number":535}]')).toBe(535)
		})
	})

	describe('when GitHub names none', () => {
		it('should read nothing', () => {
			// GIVEN an empty list, which is what an unmerged branch prints
			// WHEN read — THEN nothing, and the diff readings answer instead
			expect(mergedPullRequestIn('[]')).toBeNull()
		})
	})

	describe('when what came back is not an answer at all', () => {
		it('should read nothing rather than fall over', () => {
			// GIVEN what a `gh` that is missing, signed out, or unable to reach
			// GitHub leaves behind, and shapes that are answers to another question
			// WHEN each is read
			// THEN nothing every time. This reading may only ever say yes — a fault
			// here must send the question to the readings below, never delete a
			// branch and never refuse one on its own
			for (const printed of [
				'',
				'gh: command not found',
				'{"number":535}',
				'[{"title":"no number here"}]',
				'[null]',
				'[{"number":"535"}]',
				'null',
			] as const) {
				expect(mergedPullRequestIn(printed)).toBeNull()
			}
		})
	})
})
