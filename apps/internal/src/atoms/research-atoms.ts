import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'
import type { ListPage } from '#/lib/list-page'

export type ResearchListParams = {
	readonly subjectTable?: 'companies' | 'contacts'
	readonly subjectId?: string
	readonly status?: string
	readonly limit?: number
	readonly offset?: number
	readonly count?: 'exact' | 'none'
}

/** Turn a slice into the shape the research list atom takes. */
export function researchListPage(page: ListPage): {
	readonly limit: number
	readonly offset: number
	readonly count: 'exact' | 'none'
} {
	return { limit: page.limit, offset: page.offset, count: page.count }
}

const listCache = new Map<string, ReturnType<typeof makeListAtom>>()

function makeListAtom(params: ResearchListParams) {
	const query: Record<string, string | number> = {}
	if (params.subjectTable !== undefined) {
		query['subject_table'] = params.subjectTable
	}
	if (params.subjectId !== undefined && params.subjectId !== '') {
		query['subject_id'] = params.subjectId
	}
	if (params.status !== undefined) query['status'] = params.status
	if (params.limit !== undefined) query['limit'] = params.limit
	if (params.offset !== undefined) query['offset'] = params.offset
	if (params.count !== undefined) query['count'] = params.count
	const atom = BatudaApiAtom.query('research', 'list', {
		query,
		serializationKey: `research:list:${listKey(params)}`,
	})
	// Only the first slice is held, so returning to the runs screen paints at
	// once without pinning every slice the reader has scrolled through.
	return (params.offset ?? 0) === 0 ? Atom.keepAlive(atom) : atom
}

function listKey(params: ResearchListParams): string {
	return [
		params.subjectTable ?? '',
		params.subjectId ?? '',
		params.status ?? '',
		params.limit ?? '',
		params.offset ?? '',
		params.count ?? '',
	].join('|')
}

export function researchListAtom(params: ResearchListParams) {
	const key = listKey(params)
	const existing = listCache.get(key)
	if (existing !== undefined) return existing
	const atom = makeListAtom(params)
	listCache.set(key, atom)
	return atom
}

const detailCache = new Map<string, ReturnType<typeof makeDetailAtom>>()

function makeDetailAtom(researchId: string) {
	return BatudaApiAtom.query('research', 'get', {
		params: { id: researchId },
		serializationKey: `research:${researchId}`,
	})
}

export function researchDetailAtom(researchId: string) {
	const existing = detailCache.get(researchId)
	if (existing !== undefined) return existing
	const atom = makeDetailAtom(researchId)
	detailCache.set(researchId, atom)
	return atom
}

const runProposalsCache = new Map<
	string,
	ReturnType<typeof makeRunProposalsAtom>
>()

/** How many of a run's proposed updates the review screen holds at once. */
export const RUN_PROPOSALS_PAGE_SIZE = 100

function makeRunProposalsAtom(researchId: string) {
	return BatudaApiAtom.query('research', 'listProposedUpdates', {
		params: { id: researchId },
		// Uncounted: the review screen works through the proposals it has and
		// never states how many there are, so paying to count them would buy
		// nothing.
		query: { limit: RUN_PROPOSALS_PAGE_SIZE },
		serializationKey: `research:proposed-updates:${researchId}`,
	})
}

/** One run's proposed updates, with their `fields` and pending/resolved status. */
export function runProposedUpdatesAtom(researchId: string) {
	const existing = runProposalsCache.get(researchId)
	if (existing !== undefined) return existing
	const atom = makeRunProposalsAtom(researchId)
	runProposalsCache.set(researchId, atom)
	return atom
}

export const createResearchAtom = BatudaApiAtom.mutation('research', 'create')

/** Target correction: re-run a run anchored to a user-supplied official domain. */
export const rerunResearchAtom = BatudaApiAtom.mutation('research', 'rerun')

/** Stop a queued/running run from the run-detail screen. */
export const cancelResearchAtom = BatudaApiAtom.mutation('research', 'cancel')

/** Soft-delete a run so it drops out of the run list and inbox. */
export const deleteResearchAtom = BatudaApiAtom.mutation('research', 'delete')

/** Approve a paused run's pending paid action so the run can spend and continue. */
export const approvePaidActionAtom = BatudaApiAtom.mutation(
	'research',
	'approvePaidAction',
)

/** Skip a paused run's pending paid action so the run continues without it. */
export const skipPaidActionAtom = BatudaApiAtom.mutation(
	'research',
	'skipPaidAction',
)

/**
 * One pending proposal in the cross-run review inbox. The
 * `listPendingProposals` endpoint is typed server-side, so the atom already
 * yields this shape — the type is named here for the components' props.
 */
export type PendingProposal = {
	readonly researchId: string
	readonly runKind: string
	readonly runStatus: string
	readonly runQuery: string
	readonly runCreatedAt: unknown
	readonly runCostCents: number
	// Paid lookups are tallied apart from the cheap work; both belong to the run,
	// not to this one proposal.
	readonly runPaidCostCents: number
	readonly proposedUpdateId: string | null
	readonly subjectTable: string | null
	readonly subjectId: string | null
	readonly subjectName: string | null
	readonly operation: string
	readonly reason: string | null
	readonly confidence: number | null
	readonly verification: string | null
	readonly machineCheckable: boolean
	// The values this change would write, and the pages they were read from. Both
	// arrive as plain JSON of no fixed shape, so a reader narrows them itself
	// rather than trusting a shape nothing enforces.
	readonly fields: unknown
	readonly citations: ReadonlyArray<unknown>
	// What the record holds today for those same fields, so a reader can see what
	// a value replaces. Null when the change would create a new record, and a
	// field is absent when the record has nothing there yet.
	readonly subjectCurrent: unknown
}

export type PendingProposalsParams = {
	readonly subjectTable?: 'companies' | 'contacts'
	readonly status?: string
	readonly minConfidence?: number
	readonly machineCheckable?: boolean
	readonly limit?: number
	readonly offset?: number
	readonly count?: 'exact' | 'none'
}

const pendingProposalsCache = new Map<
	string,
	ReturnType<typeof makePendingProposalsAtom>
>()

function makePendingProposalsAtom(params: PendingProposalsParams) {
	const query: Record<string, string | number> = {}
	if (params.subjectTable !== undefined) {
		query['subject_table'] = params.subjectTable
	}
	if (params.status !== undefined) query['status'] = params.status
	if (params.minConfidence !== undefined) {
		query['min_confidence'] = params.minConfidence
	}
	if (params.machineCheckable !== undefined) {
		// The endpoint reads a tri-state string ('true' / 'false' / absent).
		query['machine_checkable'] = params.machineCheckable ? 'true' : 'false'
	}
	if (params.limit !== undefined) query['limit'] = params.limit
	if (params.offset !== undefined) query['offset'] = params.offset
	if (params.count !== undefined) query['count'] = params.count
	const atom = BatudaApiAtom.query('research', 'listPendingProposals', {
		query,
		serializationKey: `research:pending-proposals:${pendingProposalsKey(params)}`,
	})
	return (params.offset ?? 0) === 0 ? Atom.keepAlive(atom) : atom
}

function pendingProposalsKey(params: PendingProposalsParams): string {
	return [
		params.subjectTable ?? '',
		params.status ?? '',
		params.minConfidence ?? '',
		params.machineCheckable === undefined
			? ''
			: String(params.machineCheckable),
		params.limit ?? '',
		params.offset ?? '',
		params.count ?? '',
	].join('|')
}

export function pendingProposalsAtom(params: PendingProposalsParams = {}) {
	const key = pendingProposalsKey(params)
	const existing = pendingProposalsCache.get(key)
	if (existing !== undefined) return existing
	const atom = makePendingProposalsAtom(params)
	pendingProposalsCache.set(key, atom)
	return atom
}

/**
 * One paid lookup waiting on a decision, anywhere in the org. A run parks these
 * and stops before spending, so this is the only place they surface together.
 */
export type PendingPaidAction = {
	readonly researchId: string
	readonly runQuery: string
	readonly runStatus: string
	readonly runCreatedAt: unknown
	readonly actionId: string | null
	readonly tool: string
	readonly args: unknown
	readonly estimatedCents: number | null
	readonly reason: string | null
	readonly subjectTable: string | null
	readonly subjectId: string | null
	readonly subjectName: string | null
}

let pendingPaidActionsAtomCache:
	| ReturnType<typeof makePendingPaidActionsAtom>
	| undefined

function makePendingPaidActionsAtom(limit: number) {
	return BatudaApiAtom.query('research', 'listPendingPaidActions', {
		query: { limit },
		serializationKey: `research:pending-paid-actions:${limit}`,
	})
}

export function pendingPaidActionsAtom(limit: number) {
	pendingPaidActionsAtomCache ??= makePendingPaidActionsAtom(limit)
	return pendingPaidActionsAtomCache
}

const eventsCache = new Map<string, ReturnType<typeof makeEventsAtom>>()

function makeEventsAtom(researchId: string) {
	return BatudaApiAtom.query('research', 'events', {
		params: { id: researchId },
	})
}

/** One run's live event long-poll ({ status, events, done }). */
export function researchEventsAtom(researchId: string) {
	const existing = eventsCache.get(researchId)
	if (existing !== undefined) return existing
	const atom = makeEventsAtom(researchId)
	eventsCache.set(researchId, atom)
	return atom
}

export const applyProposalAtom = BatudaApiAtom.mutation(
	'research',
	'applyProposedUpdate',
)
export const rejectProposalAtom = BatudaApiAtom.mutation(
	'research',
	'rejectProposedUpdate',
)
export const resolveProposalsBatchAtom = BatudaApiAtom.mutation(
	'research',
	'resolveProposedUpdatesBatch',
)

/** The signed-in person's research budgets + auto-apply threshold. */
export const researchPolicyAtom = BatudaApiAtom.query(
	'research',
	'getPolicy',
	{},
)
export const updateResearchPolicyAtom = BatudaApiAtom.mutation(
	'research',
	'updatePolicy',
)
