import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/unstable/reactivity'
import { useEffect, useMemo, useRef, useState } from 'react'

import { researchDetailAtom, researchEventsAtom } from '#/atoms/research-atoms'
import {
	decidePoll,
	deriveProgress,
	narrowEvents,
	type ResearchEventItem,
} from '#/components/research/event-shapes'

// The events endpoint long-polls up to 30s, so a poll that returns events is
// re-armed immediately; an empty poll (run not streaming yet) waits this long
// before retrying, and the loop gives up after this many empty rounds so a
// stuck run doesn't poll forever.
const EMPTY_POLL_BACKOFF_MS = 2500
const MAX_EMPTY_POLLS = 8

function eventKey(event: ResearchEventItem): string {
	return `${event.timestamp}::${event.type}::${JSON.stringify(event.data)}`
}

/**
 * Drives the live-progress view: repeatedly polls one run's event stream,
 * accumulating events until the run reaches a terminal state, then refreshes
 * the run detail once so the page repaints with the final findings — no
 * manual reload. Only ever polls the single open run.
 */
export function useResearchEvents(
	researchId: string,
	{ enabled }: { readonly enabled: boolean },
) {
	const eventsAtom = researchEventsAtom(researchId)
	const result = useAtomValue(eventsAtom)
	const refreshEvents = useAtomRefresh(eventsAtom)
	const refreshDetail = useAtomRefresh(researchDetailAtom(researchId))

	const seenRef = useRef<Set<string>>(new Set())
	const emptyPollsRef = useRef(0)
	const doneRef = useRef(false)
	const [events, setEvents] = useState<ReadonlyArray<ResearchEventItem>>([])
	const [done, setDone] = useState(false)
	const [failed, setFailed] = useState(false)
	// The loop gave up polling before the run finished (too many empty rounds).
	// The page uses this to swap the endless progress bar for a manual refresh.
	const [stalled, setStalled] = useState(false)

	// biome-ignore lint/correctness/useExhaustiveDependencies: `result` is the poll signal — the loop re-runs each time a poll resolves.
	useEffect(() => {
		if (!enabled) return
		if (AsyncResult.isFailure(result)) {
			setFailed(true)
			return
		}
		if (!AsyncResult.isSuccess(result)) return

		const value = result.value
		const fresh = narrowEvents(value.events).filter(
			event => !seenRef.current.has(eventKey(event)),
		)
		if (fresh.length > 0) {
			for (const event of fresh) seenRef.current.add(eventKey(event))
			setEvents(prev => [...prev, ...fresh])
			emptyPollsRef.current = 0
			// New events mean the stream is alive again — clear any prior stall.
			setStalled(false)
		} else {
			emptyPollsRef.current += 1
		}

		if (value.done && !doneRef.current) {
			doneRef.current = true
			setDone(true)
			// The run just reached a terminal state — repaint the detail with
			// its final status and findings without asking the user to reload.
			refreshDetail()
		}

		const decision = decidePoll({
			enabled,
			done: value.done,
			failed: false,
			newEventCount: fresh.length,
			emptyPolls: emptyPollsRef.current,
			maxEmptyPolls: MAX_EMPTY_POLLS,
		})
		if (decision === 'poll-now') {
			refreshEvents()
			return
		}
		if (decision === 'poll-later') {
			const timer = setTimeout(() => refreshEvents(), EMPTY_POLL_BACKOFF_MS)
			return () => {
				clearTimeout(timer)
			}
		}
		// Stopped without a terminal event — the run may still be going but we
		// stopped listening, so flag a stall for the manual-refresh affordance.
		if (!value.done) setStalled(true)
		return
	}, [result, enabled])

	const progress = useMemo(() => deriveProgress(events), [events])

	return { progress, events, done, failed, stalled }
}
