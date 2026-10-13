/**
 * What to tell a model that wrote a tool call the tool would not take.
 *
 * A model that has settled on an argument name we do not have will write the
 * same call every time it is asked the same question, so a retry that re-sends
 * the conversation unchanged buys nothing — it just pays for the mistake again,
 * on every vendor slot, until the run dies. What it has never been told is what
 * went wrong.
 *
 * The arguments are read off the definition the provider was sent, rather than
 * written out here: a list kept by hand would drift the first time an argument
 * was added, and a correction that names the wrong arguments is worse than none.
 * Each argument's own words come along too — a name and a type say which
 * arguments exist, while what a country code or a recency window should look
 * like is in the description, and that is the part a model that just got the
 * call wrong needs.
 */

import { isRejectedToolCall, UNREADABLE_TOOL_NAME } from '../domain/errors'
import { toolParametersWireFormat } from './tools'

interface ParameterSchema {
	readonly type?: unknown
	readonly description?: unknown
	readonly anyOf?: ReadonlyArray<{ readonly type?: unknown }>
}

interface ToolSchema {
	readonly properties?: Record<string, ParameterSchema>
}

// The types one argument accepts, as the schema lists them: a plain type, or the
// branches of the union that stands in for "or nothing".
const typesOf = (parameter: ParameterSchema): ReadonlyArray<string> => {
	const branches = parameter.anyOf
	if (branches !== undefined) {
		const names = branches
			.map(branch => branch.type)
			.filter((name): name is string => typeof name === 'string')
		if (names.length > 0) return names
	}
	return typeof parameter.type === 'string' ? [parameter.type] : []
}

// Whether the model may answer this argument with null. Not every argument can:
// a page to fetch or a company to look up has no "no value" to send, so telling
// a model it could send null for one of those would send it back to fail again.
const acceptsNull = (parameter: ParameterSchema): boolean =>
	typesOf(parameter).includes('null')

const describeArgument = (name: string, parameter: ParameterSchema): string => {
	const types = typesOf(parameter)
	const shape = types.length > 0 ? ` (${types.join(' or ')})` : ''
	const words =
		typeof parameter.description === 'string' &&
		parameter.description.length > 0
			? ` — ${parameter.description}`
			: ''
	return `- ${name}${shape}${words}`
}

/**
 * The correction to append to the prompt after a tool call was refused.
 *
 * Names the tool, repeats what the provider or our own decoding objected to, and
 * lists the arguments the tool really takes, each with its own description. The
 * two rules a model breaks here are spelled out rather than left to be read off
 * the list: every argument must be present, and no argument outside the list is
 * allowed. A refused call usually breaks both at once.
 *
 * Saying every argument must be present holds for any tool here, rather than
 * being a guess about one of them: the strict shape these schemas are sent in
 * has no optional argument at all — one a model may skip is written as one that
 * takes null — so a tool's arguments and its required ones are the same list. A
 * test holds that to the live schema.
 *
 * Returns `undefined` for a tool the toolkit does not hold — there is nothing
 * truthful to say about a tool we cannot look up.
 */
export const rejectedToolCallCorrection = (
	toolName: string,
	mistake: string,
): string | undefined => {
	const schema = toolParametersWireFormat(toolName) as ToolSchema | undefined
	const properties = schema?.properties
	if (properties === undefined || Object.keys(properties).length === 0)
		return undefined

	const argumentLines = Object.entries(properties).map(([name, parameter]) =>
		describeArgument(name, parameter),
	)

	// Only said of a tool that has an argument taking null. On a tool whose
	// arguments all demand a real value it would be an invitation to write
	// another call we would refuse.
	const nullRule = Object.values(properties).some(acceptsNull)
		? ' Where an argument accepts null, send null rather than leaving it out.'
		: ''

	// Worded without pointing at the conversation: a round that failed never got
	// as far as adding the model's turn to the prompt, so the call being corrected
	// is not in the history the model can see. Which is no loss — it needs to be
	// told what the tool takes, not shown the call it already wrote.
	return [
		`A ${toolName} call you wrote was refused: ${mistake}`,
		`${toolName} takes exactly these arguments, and every one of them must be present:`,
		argumentLines.join('\n'),
		`Send no argument that is not on that list.${nullRule} Call ${toolName} again, written that way, and carry on with the research.`,
	].join('\n')
}

/**
 * The correction to append after the model called a tool it was not given.
 *
 * Names the tools it may call in this pass, which is the one thing that
 * changes the call it writes next. A pass that offers only some of the tools
 * refuses the rest the same way, so the list is the pass's, not the toolkit's.
 */
export const unknownToolCorrection = (
	toolName: string,
	availableTools: ReadonlyArray<string>,
): string =>
	availableTools.length === 0
		? `There is no ${toolName} tool, and no tool can be called here. Answer without calling one.`
		: `There is no ${toolName} tool. Call only ${availableTools.join(', ')}, and carry on with the research.`

/** A correction to put to the model, and the tool it is about. */
export interface ToolCallCorrection {
	readonly toolName: string
	readonly provider: string
	readonly text: string
}

/**
 * Whether a round that failed has a correction to make, and what it says.
 *
 * Three reasons there is nothing to say, and the failure stands: it was not the
 * model's own bad tool call, this pass has already spent its corrections, or the
 * tool whose arguments were refused cannot be looked up — which is what a
 * provider whose wording could not be read leaves behind.
 *
 * A call to a tool the pass does not offer is answered with the ones it does.
 * Our own client says which those are; a vendor that refuses the name at its
 * API does not, so the pass's own list (`offeredTools`) stands in.
 *
 * Only decides. Appending to the prompt and counting what has been spent are
 * left to the caller, which is what makes the decision testable on its own.
 */
export const correctionForFailedRound = (
	error: unknown,
	correctionsMade: number,
	limit: number,
	offeredTools: ReadonlyArray<string>,
): ToolCallCorrection | undefined => {
	if (!isRejectedToolCall(error) || correctionsMade >= limit) return undefined
	const notOffered =
		error.availableTools !== undefined ||
		(error.toolName !== UNREADABLE_TOOL_NAME &&
			!offeredTools.includes(error.toolName))
	const text = notOffered
		? unknownToolCorrection(
				error.toolName,
				error.availableTools ?? offeredTools,
			)
		: rejectedToolCallCorrection(error.toolName, error.mistake)
	if (text === undefined) return undefined
	return { toolName: error.toolName, provider: error.provider, text }
}
