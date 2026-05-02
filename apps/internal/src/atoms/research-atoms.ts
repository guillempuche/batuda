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

export const createResearchAtom = BatudaApiAtom.mutation('research', 'create')
