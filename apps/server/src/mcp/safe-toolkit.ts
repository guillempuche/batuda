import { Context, Effect, Layer, Option, Sink, Stream } from 'effect'
import {
	AiError,
	McpSchema,
	McpServer,
	Tool,
	type Toolkit,
} from 'effect/unstable/ai'

import { isToolMessage } from './tool-message'

// A copy of the library's toolkit registration, registering into the same shared
// server registry, so the two things below can be handled in our own code rather
// than by patching the dependency. Re-sync with the vendored effect source on an
// upgrade.
//
// The answer a tool gives: the library passes it to the client as-is whenever it
// is an object, but the MCP revision served here accepts only a plain record
// there. Nothing and a list both count as objects, so a tool that finds nothing,
// or answers with a list, ships something strict clients reject — and the tool
// vanishes from view. `toStructuredContent` below is the fix.
//
// The text a failure carries: left to the library every failure reads as one
// fixed sentence, so tools mark the ones whose wording is meant for the
// assistant and `clientFacingMessage` lets those through. See ./tool-message.

// Coerce a handler result into a value the MCP spec accepts as structured
// output. A record passes through; an array is wrapped so it stays reachable;
// anything else (null, a scalar) can't be a record, so we omit structured
// output — the field is optional and the value still rides in the text block.
export const toStructuredContent = (
	value: unknown,
): Record<string, unknown> | undefined => {
	if (Array.isArray(value)) return { items: value }
	if (value !== null && typeof value === 'object')
		return value as Record<string, unknown>
	return undefined
}

// What a caller is told when a tool fails. Anything not deliberately worded for
// them is an internal fault whose text nobody vetted — a database error arrives
// carrying table names and Postgres phrasing.
const INTERNAL_FAILURE = 'The tool failed because of an internal server error.'

export const clientFacingMessage = (error: unknown): string => {
	if (isToolMessage(error)) return error.message
	// The one library failure worth forwarding verbatim: it names the parameter
	// that was wrong, which is the only thing an assistant can act on. Its text
	// is generated from the tool's own schema, so it exposes nothing internal.
	if (
		AiError.isAiError(error) &&
		error.reason._tag === 'ToolParameterValidationError'
	)
		return error.reason.message
	return INTERNAL_FAILURE
}

const registerToolkitSafe = <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
) =>
	Effect.gen(function* () {
		const registry = yield* McpServer.McpServer
		// The toolkit is yieldable as the Effect that builds its handler map; the
		// cast mirrors the library's own cast at this boundary.
		const built = yield* toolkit as unknown as Effect.Effect<
			Toolkit.WithHandler<Tools>,
			never,
			Exclude<Tool.HandlersFor<Tools>, McpSchema.McpServerClient>
		>
		const services = yield* Effect.context<never>()
		for (const tool of Object.values(built.tools)) {
			const annotations = tool.annotations
			const mcpTool = new McpSchema.Tool({
				name: tool.name,
				description: Tool.getDescription(tool),
				inputSchema: Tool.getJsonSchema(tool),
				annotations: {
					...Option.getOrUndefined(
						Option.map(Context.getOption(annotations, Tool.Title), title => ({
							title,
						})),
					),
					readOnlyHint: Context.get(annotations, Tool.Readonly),
					destructiveHint: Context.get(annotations, Tool.Destructive),
					idempotentHint: Context.get(annotations, Tool.Idempotent),
					openWorldHint: Context.get(annotations, Tool.OpenWorld),
				},
				_meta: Context.getOrUndefined(annotations, Tool.Meta),
			})
			yield* registry.addTool({
				tool: mcpTool,
				annotations,
				// Shaping the answer first and catching afterwards is what leaves a
				// failure for the log below to see: turn both outcomes into a value up
				// front and there is nothing left to observe. It also keeps a fault
				// raised while shaping inside the same catch.
				handle: payload =>
					built.handle(tool.name as keyof Tools, payload).pipe(
						Stream.unwrap,
						Stream.run(Sink.last()),
						Effect.flatMap(Effect.fromOption),
						Effect.provide(services as Context.Context<never>),
						Effect.map((result: { readonly encodedResult: unknown }) => {
							const structured = toStructuredContent(result.encodedResult)
							return new McpSchema.CallToolResult({
								isError: false,
								structuredContent: structured,
								content: [
									{
										type: 'text',
										// A tool that answers with nothing at all serializes to
										// no text, and the result shape requires one.
										text:
											JSON.stringify(structured ?? result.encodedResult) ??
											'null',
									},
								],
							})
						}),
						// Named, so one line says which tool failed.
						Effect.tapCause(cause =>
							Effect.logError(cause).pipe(
								Effect.annotateLogs({ 'mcp.tool': tool.name }),
							),
						),
						Effect.catch(error =>
							Effect.succeed(
								new McpSchema.CallToolResult({
									isError: true,
									content: [{ type: 'text', text: clientFacingMessage(error) }],
								}),
							),
						),
						Effect.catchDefect(defect =>
							Effect.succeed(
								new McpSchema.CallToolResult({
									isError: true,
									content: [
										{ type: 'text', text: clientFacingMessage(defect) },
									],
								}),
							),
						),
					),
			})
		}
	})

// Drop-in replacement for `McpServer.toolkit` that registers a toolkit's tools
// with the structured-output fix above.
export const mcpToolkitSafe = <Tools extends Record<string, Tool.Any>>(
	toolkit: Toolkit.Toolkit<Tools>,
): Layer.Layer<
	never,
	never,
	| Tool.HandlersFor<Tools>
	| Exclude<Tool.HandlerServices<Tools>, McpSchema.McpServerClient>
> =>
	Layer.effectDiscard(registerToolkitSafe(toolkit)).pipe(
		Layer.provide(McpServer.McpServer.layer),
	)
