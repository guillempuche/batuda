import { Atom } from 'effect/unstable/reactivity'

import { BatudaApiAtom } from '#/lib/batuda-api-atom'

// Every attribute the organisation declares, whatever the stack, in one query:
// the settings page groups them by stack, the company page and the list filter
// merge them by key. Serializable so a route loader can hand it over with the
// page and the first frame already knows what a company may carry. Kept alive
// because the answer changes rarely and three pages read it: stepping from the
// list into a company and back paints the filter at once instead of a moment
// after the rest of the row.
export const attributeDeclarationsAtom = Atom.keepAlive(
	BatudaApiAtom.query('instructions', 'listAttributes', {
		query: {},
		serializationKey: 'attribute-declarations',
	}),
)

export const createAttributeAtom = BatudaApiAtom.mutation(
	'instructions',
	'createAttribute',
)
export const updateAttributeAtom = BatudaApiAtom.mutation(
	'instructions',
	'updateAttribute',
)
export const deleteAttributeAtom = BatudaApiAtom.mutation(
	'instructions',
	'deleteAttribute',
)
