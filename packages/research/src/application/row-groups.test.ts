import { describe, expect, it } from 'vitest'

import { rowGroups } from './row-groups'

// Which group each row ends up in, read back in row order.
const groupsOf = (groups: ReturnType<typeof rowGroups>, rowCount: number) =>
	Array.from({ length: rowCount }, (_, at) => groups.groupOf(at))

describe('rowGroups', () => {
	describe('when nothing has said any two rows belong together', () => {
		it('should leave every row its own group', () => {
			// GIVEN three rows and nothing joining them
			const groups = rowGroups(3)

			// WHEN read back
			// THEN each row names itself, and there are as many groups as rows
			expect(groupsOf(groups, 3)).toEqual([0, 1, 2])
			expect(groups.count()).toBe(3)
		})

		it('should find no groups in no rows', () => {
			// GIVEN nothing to group
			// WHEN counted — THEN nothing, rather than a group holding no rows
			expect(rowGroups(0).count()).toBe(0)
		})
	})

	describe('when two rows are said to belong together', () => {
		it('should put both under the earlier of the two', () => {
			// GIVEN a list of three where the last two belong together
			const groups = rowGroups(3)

			// WHEN they are joined
			groups.join(1, 2)

			// THEN the earlier row names the group, so a caller reading the rows in
			// order meets the group where it first met it
			expect(groupsOf(groups, 3)).toEqual([0, 1, 1])
			expect(groups.count()).toBe(2)
		})

		it('should name the group by the earlier row whichever way round it is told', () => {
			// GIVEN the same pair, said the other way about
			const groups = rowGroups(3)

			// WHEN joined later-first
			groups.join(2, 1)

			// THEN the answer does not depend on which of the two was named first
			expect(groupsOf(groups, 3)).toEqual([0, 1, 1])
		})
	})

	describe('when being told carries from one row to another', () => {
		it('should make one group of three from two separate sayings', () => {
			// GIVEN A belonging with B, and B belonging with C
			const groups = rowGroups(3)

			// WHEN both are said
			groups.join(0, 1)
			groups.join(1, 2)

			// THEN all three are one group: being told carries
			expect(groupsOf(groups, 3)).toEqual([0, 0, 0])
			expect(groups.count()).toBe(1)
		})

		it('should reach the same three groups whichever order it was told in', () => {
			// GIVEN the same four rows joined by the same pairs, said in two orders
			const oneWay = rowGroups(4)
			oneWay.join(0, 1)
			oneWay.join(2, 3)
			oneWay.join(1, 2)

			const other = rowGroups(4)
			other.join(1, 2)
			other.join(2, 3)
			other.join(0, 1)

			// WHEN both are read back
			// THEN they agree. A list arrives in whatever order it was written, so an
			// answer that depended on the order would be reporting the order
			expect(groupsOf(other, 4)).toEqual(groupsOf(oneWay, 4))
			expect(oneWay.count()).toBe(1)
		})

		it('should join two groups that had each already gathered rows', () => {
			// GIVEN two groups of two
			const groups = rowGroups(4)
			groups.join(0, 1)
			groups.join(2, 3)
			expect(groups.count()).toBe(2)

			// WHEN one row of each is said to belong with the other
			groups.join(1, 3)

			// THEN all four are one group, under the earliest row of either
			expect(groupsOf(groups, 4)).toEqual([0, 0, 0, 0])
			expect(groups.count()).toBe(1)
		})
	})

	describe('when the same thing is said twice', () => {
		it('should count a pair once however often it is said', () => {
			// GIVEN a pair joined
			const groups = rowGroups(3)
			groups.join(0, 1)

			// WHEN said again
			groups.join(0, 1)
			groups.join(1, 0)

			// THEN nothing changes: saying it twice is not two joins
			expect(groupsOf(groups, 3)).toEqual([0, 0, 2])
			expect(groups.count()).toBe(2)
		})

		it('should leave a row said to belong with itself alone', () => {
			// GIVEN a row joined to itself
			const groups = rowGroups(2)

			// WHEN said
			groups.join(1, 1)

			// THEN it is still its own group, not folded into anything
			expect(groupsOf(groups, 2)).toEqual([0, 1])
			expect(groups.count()).toBe(2)
		})
	})
})
