/**
 * Pure helpers for the live-progress hook — narrowing the untyped event
 * payloads and deciding the poll cadence. Kept free of React and Lingui so
 * the polling decision (the part with the tricky edge cases) is unit-tested
 * in a plain Node environment.
 */

export type ResearchEventItem = {
	readonly type: string
	readonly timestamp: string
	readonly data: Record<string, unknown>
}

export type ResearchProgress = {
	readonly phase: number | null
	readonly activeTool: string | null
	readonly sourceCount: number | null
}

export function narrowEvents(
	raw: ReadonlyArray<unknown>,
): ReadonlyArray<ResearchEventItem> {
	const out: Array<ResearchEventItem> = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const e = item as Record<string, unknown>
		if (typeof e['type'] !== 'string') continue
		out.push({
			type: e['type'],
			timestamp: typeof e['timestamp'] === 'string' ? e['timestamp'] : '',
			data:
				e['data'] && typeof e['data'] === 'object'
					? (e['data'] as Record<string, unknown>)
					: {},
		})
	}
	return out
}

/**
 * Fold the events collected so far into a snapshot of where the run is: the
 * newest phase and active tool seen, and the source count once the agent
 * reports it.
 *
 * How much work the run has got through is not counted here: these events carry
 * only what arrived while this page was open — there is no replay — so a page
 * opened partway into a run would count from one and disagree with the run's own
 * tally. That number is read off the run itself.
 */
export function deriveProgress(
	events: ReadonlyArray<ResearchEventItem>,
): ResearchProgress {
	let phase: number | null = null
	let activeTool: string | null = null
	let sourceCount: number | null = null

	for (const event of events) {
		const p = event.data['phase']
		if (typeof p === 'number') phase = p
		const tool = event.data['tool']
		if (event.type === 'tool.called' && typeof tool === 'string')
			activeTool = tool
		const sources = event.data['sourceCount']
		if (typeof sources === 'number') sourceCount = sources
	}

	return { phase, activeTool, sourceCount }
}

export type PollDecision = 'stop' | 'poll-now' | 'poll-later'

/**
 * What the polling loop should do after a poll returns. The events endpoint
 * long-polls up to 30s, so when it comes back with new events we re-arm
 * immediately; an empty return means the run isn't streaming yet (queued, or
 * finished between checks), so we wait before retrying to avoid a request
 * storm, and give up after enough empty rounds.
 */
export function decidePoll(input: {
	readonly enabled: boolean
	readonly done: boolean
	readonly failed: boolean
	readonly newEventCount: number
	readonly emptyPolls: number
	readonly maxEmptyPolls: number
}): PollDecision {
	if (!input.enabled || input.failed || input.done) return 'stop'
	if (input.emptyPolls >= input.maxEmptyPolls) return 'stop'
	if (input.newEventCount > 0) return 'poll-now'
	return 'poll-later'
}
