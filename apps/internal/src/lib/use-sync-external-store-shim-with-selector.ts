/* ESM port of `use-sync-external-store/shim/with-selector` (the production
 * build, faithful to upstream). Aliased from the package via
 * `vite.config.ts` so the bundler never reaches the original CJS file —
 * that file does `require("react")` at runtime and creates a second React
 * module instance through Node's CJS module cache, breaking SSR.
 *
 * On React 19+ this hook is reachable from libraries like
 * `@tanstack/react-store` (and other selector-based external-store
 * consumers); a throwing stub crashes hydration. The implementation here
 * reads `useSyncExternalStore` from the same React module the rest of the
 * app uses, keeping the React-instance graph clean. */
import * as React from 'react'

const objectIs: (a: unknown, b: unknown) => boolean =
	typeof Object.is === 'function'
		? Object.is
		: (x, y) =>
				(x === y && (x !== 0 || 1 / (x as number) === 1 / (y as number))) ||
				(Number.isNaN(x) && Number.isNaN(y))

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
	subscribe: (onStoreChange: () => void) => () => void,
	getSnapshot: () => Snapshot,
	getServerSnapshot: (() => Snapshot) | undefined,
	selector: (snapshot: Snapshot) => Selection,
	isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
	const instRef = React.useRef<{
		hasValue: boolean
		value: Selection | null
	} | null>(null)
	let inst: { hasValue: boolean; value: Selection | null }
	if (instRef.current === null) {
		inst = { hasValue: false, value: null }
		instRef.current = inst
	} else {
		inst = instRef.current
	}

	const [getSelection, getServerSelection] = React.useMemo(() => {
		let hasMemo = false
		let memoizedSnapshot: Snapshot
		let memoizedSelection: Selection
		const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
			if (!hasMemo) {
				hasMemo = true
				memoizedSnapshot = nextSnapshot
				const next = selector(nextSnapshot)
				if (isEqual !== undefined && inst.hasValue) {
					const current = inst.value as Selection
					if (isEqual(current, next)) {
						memoizedSelection = current
						return current
					}
				}
				memoizedSelection = next
				return next
			}
			const current = memoizedSelection
			if (objectIs(memoizedSnapshot, nextSnapshot)) return current
			const nextSelection = selector(nextSnapshot)
			if (isEqual !== undefined && isEqual(current, nextSelection)) {
				memoizedSnapshot = nextSnapshot
				return current
			}
			memoizedSnapshot = nextSnapshot
			memoizedSelection = nextSelection
			return nextSelection
		}
		const maybeGetServerSnapshot =
			getServerSnapshot === undefined ? null : getServerSnapshot
		return [
			() => memoizedSelector(getSnapshot()),
			maybeGetServerSnapshot === null
				? undefined
				: () => memoizedSelector(maybeGetServerSnapshot()),
		] as const
	}, [getSnapshot, getServerSnapshot, selector, isEqual])

	const value = React.useSyncExternalStore(
		subscribe,
		getSelection,
		getServerSelection,
	)
	React.useEffect(() => {
		inst.hasValue = true
		inst.value = value
	}, [value])
	React.useDebugValue(value)
	return value
}
