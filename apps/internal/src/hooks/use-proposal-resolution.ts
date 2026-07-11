import { useAtomSet } from '@effect/atom-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { applyProposalAtom, rejectProposalAtom } from '#/atoms/research-atoms'

export type ResolveOutcome = {
	readonly outcome: string
	readonly reason: string | null
}
export type ResolveDecision = 'apply' | 'reject'

// How long a reviewer can take back an apply/reject before it actually writes.
export const UNDO_WINDOW_MS = 5000

/**
 * Shared apply/reject behavior for both proposal-review surfaces (the cross-run
 * inbox and the per-run review), so they resolve the same way and the logic
 * lives in one place. A click shows the chosen outcome at once but holds the
 * write to the CRM for a few seconds — during that window it can be undone, so
 * an accidental Apply or Reject changes nothing. A resolution still inside its
 * window is flushed if the reviewer leaves the page, so nothing is silently
 * dropped.
 */
export function useProposalResolution() {
	const apply = useAtomSet(applyProposalAtom, { mode: 'promiseExit' })
	const reject = useAtomSet(rejectProposalAtom, { mode: 'promiseExit' })
	// Committed outcomes, keyed by the caller's row key.
	const [results, setResults] = useState<Record<string, ResolveOutcome>>({})
	// Rows whose write is still held back inside the undo window.
	const [pending, setPending] = useState<Record<string, ResolveDecision>>({})
	const held = useRef(
		new Map<
			string,
			{ timer: ReturnType<typeof setTimeout>; flush: () => void }
		>(),
	)
	const mounted = useRef(true)

	const runMutation = useCallback(
		async (
			key: string,
			researchId: string,
			puId: string,
			decision: ResolveDecision,
			onError: () => void,
		) => {
			// The write is on its way now — past the point where Undo could stop it.
			held.current.delete(key)
			const run = decision === 'apply' ? apply : reject
			const exit = await run({ params: { id: researchId, puId } })
			// The reviewer may have left while the write was in flight; it still
			// landed, so only the on-screen updates below are skipped.
			if (!mounted.current) return
			setPending(prev => {
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
		if (entry !== undefined) {
			clearTimeout(entry.timer)
			held.current.delete(key)
		}
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

	return { results, pending, resolve, undo, setResults }
}
