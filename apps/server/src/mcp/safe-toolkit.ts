import { Cause, Effect, Layer, Option, ServiceMap, Sink, Stream } from 'effect'
import { McpSchema, McpServer, Tool, type Toolkit } from 'effect/unstable/ai'

// The MCP bridge that turns a tool handler's return value into a client
// response has two client-facing defects. This is a faithful reimplementation
// of the library's `registerToolkit`/`toolkit` (see
// docs/repos/effect/packages/effect/src/unstable/ai/McpServer.ts) that
// registers into the same shared server registry (McpServer.layer) but corrects
// both — done in our own code rather than by patching the dependency. Re-sync
// with the vendored source on an effect upgrade.
//
// 1. Result shape: the library copies the raw return straight into
//    `structuredContent`, but the MCP spec requires structured output to be a
//    JSON object. A handler that returns a bare array or `null` therefore ships
//    a value strict clients reject, hiding the tool entirely.
// 2. Error text: the library renders any failure with the full `Cause.pretty`,
//    leaking internal stack frames, bundle paths, and nested cause dumps to the
//    caller. We surface only the top-level error's tag and message.

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

// Remove anything that would expose our internals: whole stack frames and
// absolute file paths (a bundle path like `/app/dist/*.mjs`, a config or secret
// path), and cap the length so a giant serialized object can't flood the caller.
const stripInternals = (text: string): string =>
	text
		// Cap first so the scan stays bounded no matter how large the input is.
		.slice(0, 2000)
		.replace(/\n\s*at\s+.*/g, '')
		// Redact absolute filesystem paths (two or more segments) while leaving
		// URLs intact — the leading slash must not follow a `:` (as in `https://`)
		// or a host character. Each segment forbids `/`, so the match is linear and
		// a slash-heavy message can't trigger runaway backtracking.
		.replace(/(?<![:\w/])(?:\/[^\s:/)'"]+){2,}\/?/g, '<path>')
		.slice(0, 500)
		.trim()

const errorLabel = (error: Error): string => {
	const tag = (error as { _tag?: unknown })._tag
	const name =
		typeof tag === 'string'
			? tag
			: error.name && error.name !== 'Error'
				? error.name
				: ''
	const message = typeof error.message === 'string' ? error.message : ''
	const label =
		name && message
			? `${name}: ${message}`
			: name || message || 'internal error'
	return stripInternals(label)
}

// Render a failure for the client from the top-level error(s) only — never the
// stack, the nested cause chain, or file paths. `prettyErrors` flattens each
// cause reason into a plain Error whose message/name/_tag we read but whose
// stack we ignore; the full cause is still logged server-side below.
export const sanitizeCause = (cause: Cause.Cause<unknown>): string => {
	const errors = Cause.prettyErrors(cause)
	if (errors.length === 0) return 'internal error'
	return errors.map(errorLabel).join('; ')
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
		const services = yield* Effect.services<never>()
		for (const tool of Object.values(built.tools)) {
			const annotations = tool.annotations
			const mcpTool = new McpSchema.Tool({
				name: tool.name,
				description: Tool.getDescription(tool),
				inputSchema: Tool.getJsonSchema(tool),
				annotations: {
					...Option.getOrUndefined(
						Option.map(
							ServiceMap.getOption(annotations, Tool.Title),
							title => ({ title }),
						),
					),
					readOnlyHint: ServiceMap.get(annotations, Tool.Readonly),
					destructiveHint: ServiceMap.get(annotations, Tool.Destructive),
					idempotentHint: ServiceMap.get(annotations, Tool.Idempotent),
					openWorldHint: ServiceMap.get(annotations, Tool.OpenWorld),
				},
				_meta: ServiceMap.getOrUndefined(annotations, Tool.Meta),
			})
			yield* registry.addTool({
				tool: mcpTool,
				annotations,
				handle: payload =>
					built.handle(tool.name as keyof Tools, payload).pipe(
						Stream.unwrap,
						Stream.run(Sink.last()),
						Effect.flatMap(Effect.fromOption),
						Effect.provideServices(services as ServiceMap.ServiceMap<never>),
						Effect.matchCause({
							onFailure: cause =>
								new McpSchema.CallToolResult({
									isError: true,
									content: [{ type: 'text', text: sanitizeCause(cause) }],
								}),
							onSuccess: (result: { readonly encodedResult: unknown }) => {
								const structured = toStructuredContent(result.encodedResult)
								return new McpSchema.CallToolResult({
									isError: false,
									structuredContent: structured,
									content: [
										{
											type: 'text',
											text: JSON.stringify(structured ?? result.encodedResult),
										},
									],
								})
							},
						}),
						Effect.tapCause(Effect.log),
					),
			})
		}
	})

// Drop-in replacement for `McpServer.toolkit` that registers a toolkit's tools
// with the record-shape and error-redaction fixes above.
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
