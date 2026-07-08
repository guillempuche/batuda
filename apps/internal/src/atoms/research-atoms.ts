import { BatudaApiAtom } from '#/lib/batuda-api-atom'

export type ResearchListParams = {
	readonly subjectTable?: 'companies' | 'contacts'
	readonly subjectId?: string
	readonly status?: string
	readonly limit?: number
	readonly offset?: number
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
	return BatudaApiAtom.query('research', 'list', { query })
}

function listKey(params: ResearchListParams): string {
	return [
		params.subjectTable ?? '',
		params.subjectId ?? '',
		params.status ?? '',
		params.limit ?? '',
		params.offset ?? '',
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

function makeRunProposalsAtom(researchId: string) {
	return BatudaApiAtom.query('research', 'listProposedUpdates', {
		params: { id: researchId },
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
	readonly proposedUpdateId: string | null
	readonly subjectTable: string | null
	readonly subjectId: string | null
	readonly operation: string
	readonly reason: string | null
	readonly confidence: number | null
	readonly verification: string | null
	readonly machineCheckable: boolean
}

export type PendingProposalsParams = {
	readonly subjectTable?: 'companies' | 'contacts'
	readonly status?: string
	readonly minConfidence?: number
	readonly machineCheckable?: boolean
	readonly limit?: number
	readonly offset?: number
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
	return BatudaApiAtom.query('research', 'listPendingProposals', { query })
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
