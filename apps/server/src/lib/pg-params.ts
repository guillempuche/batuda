import { PgTypes } from '@effect/sql-pg'
import { Result } from 'effect'

// A list of strings bound as `text[]`. The driver infers an array's type from
// its first element, so an empty list has none and is refused; naming the type
// here binds every list, empty or not. Compare against `uuid` with `::uuid[]`.
export const textArray = (values: ReadonlyArray<string>): PgTypes.Parameter =>
	Result.getOrThrow(PgTypes.array(values, PgTypes.OID.text))

// A value for a JSON column, sent as JSON text. The driver binds a bare object
// or number as its own type, which a JSON column refuses; a null stays NULL. A
// string is taken to be JSON text already, which is how clients send a payload.
export const jsonColumn = (value: unknown): string | null => {
	if (value === null || value === undefined) return null
	return typeof value === 'string' ? value : JSON.stringify(value)
}

// A row with each named JSON column sent as JSON text. A key the row does not
// carry stays absent, so a partial update leaves that column alone.
export const withJsonColumns = <Row extends Record<string, unknown>>(
	row: Row,
	columns: ReadonlyArray<keyof Row & string>,
): Row => {
	const out: Record<string, unknown> = { ...row }
	for (const column of columns)
		if (column in out) out[column] = jsonColumn(out[column])
	return out as Row
}
