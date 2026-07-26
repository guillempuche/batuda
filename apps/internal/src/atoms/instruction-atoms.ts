import { BatudaApiAtom } from '#/lib/batuda-api-atom'

// Read atoms (RLS scopes templates to the active org + actor).
export const instructionTemplatesAtom = BatudaApiAtom.query(
	'instructions',
	'listTemplates',
	{},
)

const stacksCache = new Map<string, ReturnType<typeof makeStacksAtom>>()
function makeStacksAtom(agent: string) {
	return BatudaApiAtom.query('instructions', 'listStacks', { query: { agent } })
}
// Every stack for an agent (both scopes) in one query, cached per agent so the
// same list backs the personal and org surfaces.
export function instructionStacksAtom(agent: string) {
	const existing = stacksCache.get(agent)
	if (existing !== undefined) return existing
	const atom = makeStacksAtom(agent)
	stacksCache.set(agent, atom)
	return atom
}

const resolutionCache = new Map<string, ReturnType<typeof makeResolutionAtom>>()
function makeResolutionAtom(agent: string) {
	return BatudaApiAtom.query('instructions', 'getResolution', {
		params: { agent },
	})
}
// Which default applies for an agent right now, plus the org and user defaults
// behind it — read by the inherit banner.
export function instructionResolutionAtom(agent: string) {
	const existing = resolutionCache.get(agent)
	if (existing !== undefined) return existing
	const atom = makeResolutionAtom(agent)
	resolutionCache.set(agent, atom)
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
export const createStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'createStack',
)
export const updateStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'updateStack',
)
export const deleteStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'deleteStack',
)
export const setDefaultStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'setDefaultStack',
)
export const clearDefaultStackAtom = BatudaApiAtom.mutation(
	'instructions',
	'clearDefaultStack',
)
