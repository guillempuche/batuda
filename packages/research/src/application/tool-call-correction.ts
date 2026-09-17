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

import { Effect, Stream } from 'effect'
import { AiError, type Tool, type Toolkit } from 'effect/unstable/ai'

import { isRejectedToolCall, REJECTED_TOOL_CALL } from '../domain/errors'
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
 * tool named cannot be looked up — which is what a provider whose wording could
 * not be read leaves behind.
 *
 * Only decides. Appending to the prompt and counting what has been spent are
 * left to the caller, which is what makes the decision testable on its own.
 */
export const correctionForFailedRound = (
	error: unknown,
	correctionsMade: number,
	limit: number,
): ToolCallCorrection | undefined => {
	if (!isRejectedToolCall(error) || correctionsMade >= limit) return undefined
	const text = rejectedToolCallCorrection(error.toolName, error.mistake)
	if (text === undefined) return undefined
	return { toolName: error.toolName, provider: error.provider, text }
}

// The two mistakes the model can make that a toolkit refuses before any handler
// runs: naming a tool we do not have, and writing arguments that do not fit the
// tool's schema.
const isModelsMistake = (err: unknown): err is AiError.AiError =>
	err instanceof AiError.AiError &&
	(err.reason._tag === 'ToolNotFoundError' ||
		err.reason._tag === REJECTED_TOOL_CALL)

// What the model is handed back in place of the result it asked for. Shaped like
// the other results a tool can answer with — a status and the facts behind it —
// so it reads as an answer rather than as something gone wrong.
const badCallResult = (reason: AiError.AiErrorReason): unknown => {
	if (reason._tag === 'ToolNotFoundError') {
		return {
			status: 'no_such_tool',
			tool: reason.toolName,
			available_tools: reason.availableTools,
			message: `There is no ${reason.toolName} tool. Call one of the tools listed in available_tools instead.`,
		}
	}
	if (reason._tag === REJECTED_TOOL_CALL) {
		return {
			status: 'invalid_arguments',
			tool: reason.toolName,
			error: reason.description,
			message:
				rejectedToolCallCorrection(reason.toolName, reason.description) ??
				`The arguments for ${reason.toolName} did not fit the tool. Check its description and call it again.`,
		}
	}
	return { status: 'invalid_arguments' }
}

/**
 * A toolkit that answers a call the model wrote wrongly instead of ending the
 * round.
 *
 * A tool that fails while running already comes back to the model as a result —
 * that is what `failureMode: 'return'` buys, so one dead page cannot sink a run.
 * A call refused BEFORE the handler runs does not: the toolkit checks the tool's
 * name and decodes its arguments first, and either check failing takes down the
 * whole round. Since a round's tool calls are resolved together, that also
 * discards whatever the model's other calls had already found. So both checks
 * answer with a result saying what was wrong and what the tool really accepts,
 * which the model reads beside its own call and acts on next round.
 *
 * What this cannot reach is a provider that refuses the call at its own API: the
 * answer then carries no tool calls at all, so there is nothing to reply to. The
 * run's correction after a failed round is what covers that.
 */
export const toolkitAnsweringBadCalls = <
	Tools extends Record<string, Tool.Any>,
>(
	toolkit: Toolkit.WithHandler<Tools>,
): Toolkit.WithHandler<Tools> => ({
	tools: toolkit.tools,
	handle: ((name: string, params: unknown, toolCallId?: string) =>
		(
			toolkit.handle as unknown as (
				name: string,
				params: unknown,
				toolCallId?: string,
			) => Effect.Effect<
				Stream.Stream<unknown, unknown, unknown>,
				AiError.AiError
			>
		)(name, params, toolCallId).pipe(
			Effect.catchIf(isModelsMistake, err => {
				const result = badCallResult(err.reason)
				return Effect.succeed(
					Stream.succeed({
						result,
						// Already a plain JSON value, so what the provider is sent is
						// what is written here rather than a re-encoding of it.
						encodedResult: result,
						isFailure: true,
						preliminary: false,
					}),
				)
			}),
		)) as unknown as Toolkit.WithHandler<Tools>['handle'],
})
