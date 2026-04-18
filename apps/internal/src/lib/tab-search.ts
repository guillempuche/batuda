import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * URL-addressable tab state via `?tab=<value>`. `strict: false` resolves
 * against the current route match so callers don't have to bind `from`.
 * Writes push history entries so back/forward steps through tab states.
 *
 * The consuming route must pair this with a `stripSearchParams({ tab:
 * <fallback> })` middleware — the middleware drops the default from both
 * the URL and the `useSearch()` result, which lets `setTab` write
 * `tab: next` unconditionally (no branch on `next === fallback`).
 */
export function useTabSearchParam<T extends string>(
	tabs: ReadonlyArray<T>,
	fallback: T,
): readonly [T, (next: T) => void] {
	const search = useSearch({ strict: false }) as
		| { readonly tab?: unknown }
		| undefined
	const rawTab = search?.tab
	const currentTab: T =
		typeof rawTab === 'string' &&
		(tabs as ReadonlyArray<string>).includes(rawTab)
			? (rawTab as T)
			: fallback

	const navigate = useNavigate()
	const setTab = useCallback(
		(next: T) => {
			void navigate({
				search: (prev: Record<string, unknown>) => ({ ...prev, tab: next }),
			} as never)
		},
		[navigate],
	)

	return [currentTab, setTab] as const
}
