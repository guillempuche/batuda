import { useLocation, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import { returnFocusToPage } from './return-focus-to-page'

/**
 * The row a reader is looking at, held in `?read=<id>`.
 *
 * Reading sits apart from the `?dlg=` key on purpose: `dlg` says which editor
 * is open and only one can be, so its values replace each other, while reading
 * opens *over* any of them — above all over a half-written stack, where losing
 * the draft to check what a template says would be the wrong trade.
 *
 * Opening pushes a history entry so Back stops reading; closing drops the key
 * with `replace` so Back doesn't reopen it. Neither scrolls the page.
 */
export function useReadParam(): {
	readonly readId: string | undefined
	readonly openRead: (id: string) => void
	readonly closeRead: () => void
} {
	const readId = useLocation({
		select: l => {
			const raw = (l.search as { readonly read?: unknown } | undefined)?.read
			return typeof raw === 'string' && raw.length > 0 ? raw : undefined
		},
	})

	const navigate = useNavigate()
	const openRead = useCallback(
		(id: string) => {
			void navigate({
				search: (prev: Record<string, unknown>) => ({ ...prev, read: id }),
				resetScroll: false,
			} as never)
		},
		[navigate],
	)
	const closeRead = useCallback(() => {
		void navigate({
			search: ({ read: _drop, ...rest }: Record<string, unknown>) => rest,
			replace: true,
			resetScroll: false,
		} as never)
		returnFocusToPage()
	}, [navigate])

	return { readId, openRead, closeRead }
}
