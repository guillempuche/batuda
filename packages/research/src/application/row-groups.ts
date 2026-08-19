/**
 * Gathering rows of one list into groups, where anything may say that two of them
 * belong together and being told so carries: A joined to B and B to C makes one
 * group of three, however the three were reached.
 *
 * This exists because two places have to agree about it. The fold that joins the
 * rows of one discovery scan works out which rows are one company; the measurement
 * of how many duplicates a list still holds works out the same thing again over the
 * list that came back. Written twice, the two could quietly stop agreeing — and a
 * measurement that disagrees with the thing it measures is worse than none, because
 * it is read as an answer. Written once, they cannot.
 *
 * The group is named by its earliest row. That is what lets a caller keep the order
 * a list arrived in: whichever rows turn out to belong together, and in whatever
 * order they were joined up, the group answers with the first of them.
 */
export interface RowGroups {
	/** The row naming the group this row belongs to — itself, when nothing joined it. */
	readonly groupOf: (row: number) => number
	/** Say that two rows belong together. Saying it twice costs nothing. */
	readonly join: (a: number, b: number) => void
	/** How many groups the rows have turned out to be. */
	readonly count: () => number
}

export const rowGroups = (rowCount: number): RowGroups => {
	const groupOfRow = Array.from({ length: rowCount }, (_, at) => at)
	const groupOf = (row: number): number => {
		let at = row
		let of = groupOfRow[at]
		while (of !== undefined && of !== at) {
			at = of
			of = groupOfRow[at]
		}
		return at
	}
	return {
		groupOf,
		join: (a, b) => {
			const one = groupOf(a)
			const other = groupOf(b)
			if (one === other) return
			// The earlier row names the group, so a caller reading the rows in order
			// meets each group where it first met it.
			groupOfRow[Math.max(one, other)] = Math.min(one, other)
		},
		count: () => {
			const groups = new Set<number>()
			for (let at = 0; at < rowCount; at++) groups.add(groupOf(at))
			return groups.size
		},
	}
}
