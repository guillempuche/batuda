import { Schema } from 'effect'

/**
 * A record id in the address, for records whose id column is a uuid. Without
 * the check, text that is not one reaches the database, which refuses it, and
 * the caller is told the server broke when they only mistyped an address. Any
 * hex in the 8-4-4-4-12 shape passes, as Postgres takes it, rather than only the
 * versions a strict UUID check allows.
 */
export const UuidParam = Schema.String.check(
	Schema.isPattern(
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
		{ expected: 'a UUID' },
	),
)
