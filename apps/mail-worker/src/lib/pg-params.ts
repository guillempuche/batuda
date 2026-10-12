import { PgTypes } from '@effect/sql-pg'
import { Result } from 'effect'

// A list of strings bound as `text[]`. The driver infers an array's type from
// its first element, so an empty list has none and is refused; naming the type
// here binds every list, empty or not. Compare against `uuid` with `::uuid[]`.
export const textArray = (values: ReadonlyArray<string>): PgTypes.Parameter =>
	Result.getOrThrow(PgTypes.array(values, PgTypes.OID.text))
