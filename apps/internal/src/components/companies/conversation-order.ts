/**
 * Newest first, with rows that carry no usable date (an open task with no due
 * date) after every dated one, in the order they arrived.
 */
export function newestFirstUndatedLast<
	T extends { readonly date: string | null },
>(rows: ReadonlyArray<T>): Array<T> {
	const dated: Array<{ readonly row: T; readonly time: number }> = []
	const undated: Array<T> = []
	for (const row of rows) {
		const time = row.date === null ? Number.NaN : Date.parse(row.date)
		if (Number.isNaN(time)) undated.push(row)
		else dated.push({ row, time })
	}
	dated.sort((a, b) => b.time - a.time)
	return [...dated.map(entry => entry.row), ...undated]
}
