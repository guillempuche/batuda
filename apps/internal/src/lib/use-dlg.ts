import { useLocation, useNavigate } from '@tanstack/react-router'
import { Option, Schema } from 'effect'
import { useCallback, useMemo } from 'react'

/**
 * URL-addressable dialog state via the `?dlg=` search param, shared by every
 * route that opens a dialog (see `dlg-search.ts` for the struct vocabulary).
 *
 * Reads the live URL and decodes it against `schema` — a `Schema.Union` of the
 * kinds this route owns. A `?dlg=` value outside that union decodes to
 * `undefined`, so a page only ever opens a dialog it declares.
 *
 * Navigation mirrors `useTabSearchParam`: it writes only the `dlg` key and omits
 * `to`, so the same hook serves routes with or without path params (the current
 * route + params are preserved). Opening pushes a history entry so Back closes
 * the dialog; closing drops the key with `replace` so Back does not reopen it
 * and the URL goes clean. `dlg` is read from the live location because removing
 * the last search param can leave the route match's validated search stale.
 */
export function useDlg<S extends Schema.Top>(
	schema: S,
): {
	readonly dlg: S['Type'] | undefined
	readonly open: (next: S['Type']) => void
	readonly close: () => void
} {
	const rawDlg = useLocation({
		select: l => (l.search as { readonly dlg?: unknown } | undefined)?.dlg,
	})
	// `Schema.Top` carries an `unknown` decoding-services slot that
	// `decodeUnknownOption` rejects; the cast pins it to a plain codec, matching
	// `validateSearchWith`. The decoded value is `S['Type']` by construction.
	const decode = useMemo(
		() =>
			Schema.decodeUnknownOption(schema as unknown as Schema.Codec<unknown>),
		[schema],
	)
	const dlg = useMemo(
		() => Option.getOrUndefined(decode(rawDlg)) as S['Type'] | undefined,
		[decode, rawDlg],
	)

	const navigate = useNavigate()
	const open = useCallback(
		(next: S['Type']) => {
			void navigate({
				search: (prev: Record<string, unknown>) => ({ ...prev, dlg: next }),
			} as never)
		},
		[navigate],
	)
	const close = useCallback(() => {
		void navigate({
			search: ({ dlg: _drop, ...rest }: Record<string, unknown>) => rest,
			replace: true,
		} as never)
	}, [navigate])

	return { dlg, open, close }
}
