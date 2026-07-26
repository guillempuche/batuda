import { BatudaApiAtom } from '#/lib/batuda-api-atom'

/**
 * Queries for documents, cached by what they ask for.
 *
 * The cache is what lets a page rendered on the server hand its answer to the
 * browser: both sides have to reach for the same query object, and building a
 * fresh one each render would give them two.
 */

const detailCache = new Map<string, ReturnType<typeof makeDetailAtom>>()

function makeDetailAtom(id: string) {
	return BatudaApiAtom.query('documents', 'get', {
		params: { id },
		serializationKey: `document:${id}`,
	})
}

export function documentAtomFor(id: string) {
	const existing = detailCache.get(id)
	if (existing !== undefined) return existing
	const atom = makeDetailAtom(id)
	detailCache.set(id, atom)
	return atom
}
