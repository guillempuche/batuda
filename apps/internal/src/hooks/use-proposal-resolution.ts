import { useAtomSet } from '@effect/atom-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { applyProposalAtom, rejectProposalAtom } from '#/atoms/research-atoms'

export type ResolveOutcome = {
	readonly outcome: string
	readonly reason: string | null
}
export type ResolveDecision = 'apply' | 'reject'

// How long a reviewer can take back an apply/reject before it actually writes.
// Long enough to be usable by someone who has to find the control first: a
// listener hears the row change, moves to the button and presses it, which does
// not happen in five seconds. There is no way to extend it once it starts, so
// the window itself has to be generous.
export const UNDO_WINDOW_MS = 20000

/**
 * Shared apply/reject behavior for both proposal-review surfaces (the cross-run
 * inbox and the per-run review), so they resolve the same way and the logic
 * lives in one place. A click shows the chosen outcome at once but holds the
 * write to the CRM for a few seconds — during that window it can be undone, so
 * an accidental Apply or Reject changes nothing. A resolution still inside its
 * window is flushed if the reviewer leaves the page, so nothing is silently
 * dropped.
 *
 * `onResolved` runs once each write reaches the server, whether or not the
 * surface is still on screen. The per-run review passes it to re-read the run's
 * saved proposals, so the outcome is drawn from what is stored rather than only
 * from this reply — that is what keeps the outcome visible when the page settles
 * and swaps the card out from under an in-flight write.
 */
export function useProposalResolution(options?: {
	readonly onResolved?: () => void
}) {
	const apply = useAtomSet(applyProposalAtom, { mode: 'promiseExit' })
	const reject = useAtomSet(rejectProposalAtom, { mode: 'promiseExit' })
	// Committed outcomes, keyed by the caller's row key.
	const [results, setResults] = useState<Record<string, ResolveOutcome>>({})
	// Rows whose write is still held back inside the undo window.
	const [pending, setPending] = useState<Record<string, ResolveDecision>>({})
	// Rows whose write has already left for the server. Kept apart from `pending`
	// because taking it back is no longer possible: offering to undo here would
	// clear the row on screen while the change still lands.
	const [sending, setSending] = useState<Record<string, ResolveDecision>>({})
	const held = useRef(
		new Map<
			string,
			{ timer: ReturnType<typeof setTimeout>; flush: () => void }
		>(),
	)
	const mounted = useRef(true)
	// Held in a ref so the callback can change between renders without rebuilding
	// the mutation, and so the flush that fires on unmount still reaches it.
	const onResolvedRef = useRef(options?.onResolved)
	onResolvedRef.current = options?.onResolved

	const runMutation = useCallback(
		async (
			key: string,
			researchId: string,
			puId: string,
			decision: ResolveDecision,
			onError: () => void,
		) => {
			// The write is on its way now — past the point where Undo could stop it,
			// so the row moves out of the undoable set and says so on screen.
			held.current.delete(key)
			setPending(prev => {
				const next = { ...prev }
				delete next[key]
				return next
			})
			setSending(prev => ({ ...prev, [key]: decision }))
			const run = decision === 'apply' ? apply : reject
			const exit = await run({ params: { id: researchId, puId } })
			// The write has landed. Re-read the stored proposals now, before the
			// mounted check, so a card swapped in by the settling page still shows
			// the outcome even though the card that fired the write has gone.
			onResolvedRef.current?.()
			// The reviewer may have left while the write was in flight; it still
			// landed, so only the on-screen updates below are skipped.
			if (!mounted.current) return
			setSending(prev => {
				const next = { ...prev }
				delete next[key]
				return next
			})
			if (exit._tag === 'Success') {
				setResults(prev => ({
					...prev,
					[key]: {
						outcome: exit.value.outcome,
						reason: exit.value.reason ?? null,
					},
				}))
			} else {
				onError()
			}
		},
		[apply, reject],
	)

	const resolve = useCallback(
		(
			key: string,
			researchId: string,
			puId: string,
			decision: ResolveDecision,
			onError: () => void,
		) => {
			setPending(prev => ({ ...prev, [key]: decision }))
			const flush = () =>
				void runMutation(key, researchId, puId, decision, onError)
			const timer = setTimeout(flush, UNDO_WINDOW_MS)
			held.current.set(key, { timer, flush })
		},
		[runMutation],
	)

	const undo = useCallback((key: string) => {
		const entry = held.current.get(key)
		// Nothing held means the write already left. Clearing the row here would
		// tell the reader it was taken back while the change still lands, so the
		// row is left alone to finish and report its real outcome.
		if (entry === undefined) return
		clearTimeout(entry.timer)
		held.current.delete(key)
		setPending(prev => {
			const next = { ...prev }
			delete next[key]
			return next
		})
	}, [])

	useEffect(() => {
		return () => {
			mounted.current = false
			// Snapshot first: each flush() deletes its own entry from `held`, so
			// iterating the live map while flushing would be modifying it mid-loop.
			const entries = [...held.current.values()]
			held.current.clear()
			for (const entry of entries) {
				clearTimeout(entry.timer)
				entry.flush()
			}
		}
	}, [])

	return { results, pending, sending, resolve, undo, setResults }
}
