import { Schema } from 'effect'

/**
 * Building blocks for a route's dialog vocabulary, stored in the `?dlg=`
 * search param.
 *
 * A dialog is identified in the URL by a small object — `{ kind }` for a
 * dialog that opens on its own, or `{ kind, id }` for one that targets a row.
 * TanStack already turns the nested search object back into JS before
 * `validateSearch` runs, so each route validates `dlg` as a plain
 * `Schema.Union` of these structs (see `routes/emails/inboxes.tsx`).
 *
 * Because each route lists only the kinds it owns, a `?dlg=` value a route
 * doesn't recognise fails to decode and the dialog simply stays closed — a
 * page can only open the dialogs it declares.
 */

/** A dialog that targets a specific row: its `id` must be present and non-empty. */
export const dlgWithId = <const K extends string>(kind: K) =>
	Schema.Struct({ kind: Schema.Literal(kind), id: Schema.NonEmptyString })

/** A dialog that opens without a target row. */
export const dlgNoId = <const K extends string>(kind: K) =>
	Schema.Struct({ kind: Schema.Literal(kind) })
