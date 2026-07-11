import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Multi-select state for a list or board: a set of selected ids with toggle /
 * select-all / clear, plus automatic pruning of ids that scroll out of view (a
 * filter or navigation change) so a stale selection can never act on rows the
 * user can no longer see. Generalizes the selection pattern in
 * `routes/emails/index.tsx` for reuse by the companies list and the board.
 */
export function useBulkSelection(visibleIds: ReadonlyArray<string>): {
	readonly selected: ReadonlySet<string>
	readonly selectedCount: number
	readonly isSelected: (id: string) => boolean
	readonly toggle: (id: string) => void
	readonly selectAll: () => void
	readonly clear: () => void
} {
	const [selected, setSelected] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	)

	// A stable string key so the prune effect fires on membership changes, not on
	// every new array identity.
	const visibleKey = visibleIds.join(',')

	useEffect(() => {
		setSelected(prev => {
			if (prev.size === 0) return prev
			const visible = new Set(visibleKey ? visibleKey.split(',') : [])
			let changed = false
			const next = new Set<string>()
			for (const id of prev) {
				if (visible.has(id)) next.add(id)
				else changed = true
			}
			return changed ? next : prev
		})
	}, [visibleKey])

	const toggle = useCallback((id: string) => {
		setSelected(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}, [])

	const selectAll = useCallback(() => {
		setSelected(new Set(visibleKey ? visibleKey.split(',') : []))
	}, [visibleKey])

	const clear = useCallback(() => {
		setSelected(new Set<string>())
	}, [])

	return useMemo(
		() => ({
			selected,
			selectedCount: selected.size,
			isSelected: (id: string) => selected.has(id),
			toggle,
			selectAll,
			clear,
		}),
		[selected, toggle, selectAll, clear],
	)
}
