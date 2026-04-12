import { Console, Effect } from 'effect'

interface Column<T> {
	readonly header: string
	readonly width: number
	readonly value: (row: T) => string
}

export const printTable = <T>(
	columns: ReadonlyArray<Column<T>>,
	rows: ReadonlyArray<T>,
) =>
	Effect.gen(function* () {
		const pad = (text: string, w: number) => (w > 0 ? text.padEnd(w) : text)
		const headerLine = columns.map(c => pad(c.header, c.width)).join('')
		const totalWidth = columns.reduce(
			(sum, c) => sum + Math.max(c.width, c.header.length),
			0,
		)
		yield* Console.log(headerLine)
		yield* Console.log(''.padEnd(totalWidth, '─'))
		for (const row of rows) {
			yield* Console.log(columns.map(c => pad(c.value(row), c.width)).join(''))
		}
	})
