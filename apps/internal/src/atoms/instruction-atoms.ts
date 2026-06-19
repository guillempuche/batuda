import { BatudaApiAtom } from '#/lib/batuda-api-atom'

// Read atoms (RLS scopes templates/donations to the active org + actor).
export const instructionTemplatesAtom = BatudaApiAtom.query(
	'instructions',
	'listTemplates',
	{},
)

export const instructionDonationsAtom = BatudaApiAtom.query(
	'instructions',
	'listDonations',
	{ query: {} },
)

const detailCache = new Map<string, ReturnType<typeof makeDetailAtom>>()
function makeDetailAtom(id: string) {
	return BatudaApiAtom.query('instructions', 'getTemplate', { params: { id } })
}
export function instructionTemplateAtom(id: string) {
	const existing = detailCache.get(id)
	if (existing !== undefined) return existing
	const atom = makeDetailAtom(id)
	detailCache.set(id, atom)
	return atom
}

const stacksCache = new Map<string, ReturnType<typeof makeStacksAtom>>()
function makeStacksAtom(agent: string) {
	return BatudaApiAtom.query('instructions', 'getDefaultStacks', {
		params: { agent },
	})
}
export function defaultStacksAtom(agent: string) {
	const existing = stacksCache.get(agent)
	if (existing !== undefined) return existing
	const atom = makeStacksAtom(agent)
	stacksCache.set(agent, atom)
	return atom
}

// Write atoms.
export const createTemplateAtom = BatudaApiAtom.mutation(
	'instructions',
	'createTemplate',
)
export const updateTemplateAtom = BatudaApiAtom.mutation(
	'instructions',
	'updateTemplate',
)
export const deleteTemplateAtom = BatudaApiAtom.mutation(
	'instructions',
	'deleteTemplate',
)
export const transferTemplateAtom = BatudaApiAtom.mutation(
	'instructions',
	'transferTemplate',
)
export const donateTemplateAtom = BatudaApiAtom.mutation(
	'instructions',
	'donateTemplate',
)
export const setUserStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'setUserStack',
)
export const setOrgStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'setOrgStack',
)
export const clearUserStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'clearUserStack',
)
export const acceptDonationAtom = BatudaApiAtom.mutation(
	'instructions',
	'acceptDonation',
)
export const rejectDonationAtom = BatudaApiAtom.mutation(
	'instructions',
	'rejectDonation',
)
