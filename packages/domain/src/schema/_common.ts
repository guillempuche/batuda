import { Schema } from 'effect'

// `numeric` columns arrive as strings from Postgres; accept string-or-number on
// decode and always emit a JSON number (the number branch wins on encode).
//
// Finite rather than a plain number: a plain number also publishes "NaN" and
// "Infinity" as alternatives, which makes this a choice inside a choice once it
// is wrapped in "or nothing" — a shape some model providers refuse to read. No
// column this describes can hold either value anyway.
export const DbNumber = Schema.Union([Schema.Finite, Schema.NumberFromString])

// The same, for a column that may hold nothing. Written as one choice of three
// rather than `NullOr(DbNumber)`, because wrapping a choice in "or nothing"
// publishes a choice inside a choice — the shape some model providers refuse to
// read. Flattened here so no caller has to remember.
export const DbNumberOrNull = Schema.Union([
	Schema.Finite,
	Schema.NumberFromString,
	Schema.Null,
])
