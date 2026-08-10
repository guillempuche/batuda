/**
 * Shared schema helpers for reading vendor responses.
 *
 * A description stricter than what the vendor actually sends throws away an
 * answer that arrived — and was billed — successfully, so every field we do
 * not strictly need is read as "may be absent, may be null".
 */

import { Schema } from 'effect'

/**
 * A field that may be missing entirely or sent as an explicit `null`.
 * `Schema.optional` on its own accepts a missing key but rejects a `null`,
 * which a vendor that documents a field as nullable will eventually send.
 */
export const NullableOptional = <S extends Schema.Top>(schema: S) =>
	Schema.optional(Schema.NullOr(schema))

/**
 * A text field the vendor may send as one value or as a list of them: a page
 * declaring its language in both an `<html lang>` attribute and a
 * `<meta name="language">` tag comes back as `["es-ES","ES"]`, and so does a
 * title the fallback extractor reads twice.
 */
export const NullableOptionalTextOrList = NullableOptional(
	Schema.Union([Schema.String, Schema.Array(Schema.String)]),
)

/**
 * The one value a one-or-many text field carries; nothing when it carries none.
 */
export const firstText = (
	value: string | ReadonlyArray<string> | null | undefined,
): string | undefined =>
	typeof value === 'string' ? value : (value?.[0] ?? undefined)
