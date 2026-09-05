import { isTerminalResearchStatus } from '@batuda/domain'
import type { ResearchLiveSnapshot } from '@batuda/research'

/**
 * What a watching page is told about a run, and how each figure is worked out.
 *
 * Kept apart from the route that sends it, and free of Effect, the database and
 * the HTTP layer, because the rules here are the ones easiest to get quietly
 * wrong — a phase read one behind, a zero standing in for an answer nobody has
 * yet — and this way they can be read and tested on their own.
 */

// The one status that means a run is doing something right now. Queued is not
// it — the run is waiting its turn — and every other status is an ending.
const RUNNING_STATUS = 'running'

/**
 * What the run last reached for, as its events report it. A call names the tool;
 * its result means nothing is running just then, so the name is taken back
 * rather than left standing over the phases that follow it.
 */
export const toolFromEvent = (
	event: unknown,
): { readonly tool: string | null } | null => {
	if (event === null || typeof event !== 'object') return null
	const e = event as { type?: unknown; data?: unknown }
	if (e.type === 'tool.result') return { tool: null }
	if (e.type !== 'tool.called') return null
	const tool = (e.data as { tool?: unknown } | null)?.tool
	return typeof tool === 'string' ? { tool } : null
}

/**
 * Which phase a run is working on, from the count of those it has finished.
 *
 * The column records phases *completed*: it reaches 1 when gathering ends and 2
 * when extraction does, and only reaches 3 alongside a terminal status. So while
 * a run is going, the one it is working on is the next one — reading the column
 * itself named the phase before, and a run gathering evidence read as not
 * started. Derived rather than carried in the events, so a page that joins a run
 * halfway through knows it too.
 */
const workingPhase = (row: ResearchLiveSnapshot): number | null =>
	// Only a run that is actually going is on a phase. A queued one has been
	// asked for and not yet picked up, and reading its column as "none finished,
	// so it must be on the first" had the page announce it was gathering evidence
	// before anything had touched it.
	row.status === RUNNING_STATUS ? Math.min(row.phase + 1, 3) : null

/**
 * One frame of the live stream: the whole of where a run is.
 *
 * Whole rather than a difference from the last frame, so a watcher that joins
 * partway through a run — or misses a frame — still shows the truth.
 *
 * `activeTool` is the one figure the run's row does not keep, so it is carried
 * from the events and is null on a page that joined after the run last reached
 * for something. Everything else survives a reload.
 */
export const liveFrame = (
	row: ResearchLiveSnapshot,
	activeTool: string | null,
) => ({
	status: row.status,
	phase: workingPhase(row),
	activeTool,
	sourceCount: row.sourceCount,
	progressSteps: row.progressSteps,
	costCents: row.costCents,
	paidCostCents: row.paidCostCents,
	budgetCents: row.budgetCents,
	paidBudgetCents: row.paidBudgetCents,
	// A run that has written nothing down has no count to give; zero would say
	// it looked and found none, which is a different answer.
	foundCount: row.hasFindings ? row.foundCount : null,
	pendingProposalCount: row.hasFindings ? row.pendingProposalCount : null,
	done: isTerminalResearchStatus(row.status),
})

/**
 * The last thing a watcher is told about a run that has gone from under them —
 * soft-deleted, or no longer theirs to read. Marked finished so the page stops
 * waiting and asks the run for itself, which is what says it is gone.
 */
export const goneFrame = (frame: ReturnType<typeof liveFrame>) => ({
	...frame,
	status: 'deleted',
	phase: null,
	done: true,
})
