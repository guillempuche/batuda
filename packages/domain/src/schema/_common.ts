import { Schema } from 'effect'

// `numeric` columns arrive as strings from Postgres; accept string-or-number on
// decode and always emit a JSON number (the `Number` branch wins on encode).
export const DbNumber = Schema.Union([Schema.Number, Schema.NumberFromString])
