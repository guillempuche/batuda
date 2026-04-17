import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * URL-addressable tab state via `?tab=<value>`. Reads the param through
 * TanStack Router's `useSearch` with `strict: false` (it resolves against
 * the current route match — no `from` binding needed) and narrows it to
 * the allowed literal union. Writes push new history entries so the
 * browser back/forward buttons step through tab states.
 *
 * When the chosen tab equals the fallback, the param is dropped entirely
 * so the default URL stays clean (`/companies/foo` rather than
 * `/companies/foo?tab=profile`).
 */
export function useTabSearchParam<T extends string>(
	tabs: ReadonlyArray<T>,
	fallback: T,
): readonly [T, (next: T) => void] {
	const search = useSearch({ strict: false }) as
		| { readonly tab?: unknown }
		| undefined
	const raw = search?.tab
	const current: T =
		typeof raw === 'string' && (tabs as ReadonlyArray<string>).includes(raw)
			? (raw as T)
			: fallback

	const navigate = useNavigate()
	const setTab = useCallback(
		(next: T) => {
			void navigate({
				search: (prev: Record<string, unknown>) => ({
					...prev,
					tab: next === fallback ? undefined : next,
				}),
			} as never)
		},
		[navigate, fallback],
	)

	return [current, setTab] as const
}
