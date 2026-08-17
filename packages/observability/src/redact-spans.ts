import type { Tracer } from 'effect'

// Attributes that carry whatever a caller sent, verbatim: every tool call's
// arguments land under `parameters`, and those include a mailbox password on the
// tool that connects a mailbox and a whole file on the one that attaches a file.
// Exporting a span would send all of it to the tracing vendor in the clear.
//
// The whole value goes, not the fields that look sensitive: any such list holds
// only until someone adds a field nobody thought to name, and that field would
// be a secret exactly when it mattered. Whatever is worth tracing gets its own
// attribute, deliberately — `mcp.tool` rather than a slice of `parameters`.
const OPAQUE_ATTRIBUTES = new Set(['parameters'])

const REDACTED = '<redacted>'

/**
 * Applies the same rule to a plain bag of facts, for the paths that do not go
 * through a span. Wrapping the tracer only protects span attributes, so any
 * other route out of the process — a fact gathered onto a log line — has to be
 * filtered here or the wrapper is a door with a hole beside it.
 *
 * Returns the original object untouched when nothing matches, so the common case
 * costs one lookup per key and no copy.
 */
export const redactFacts = (
	facts: Record<string, unknown>,
): Record<string, unknown> => {
	let redacted: Record<string, unknown> | undefined
	for (const key of Object.keys(facts)) {
		if (!OPAQUE_ATTRIBUTES.has(key)) continue
		redacted ??= { ...facts }
		redacted[key] = REDACTED
	}
	return redacted ?? facts
}

/**
 * Wraps a tracer so those attributes are replaced on the way out — the recording
 * happens inside a library, so it is caught here rather than there. Every other
 * attribute passes through untouched.
 */
export const redactingTracer = (inner: Tracer.Tracer): Tracer.Tracer => ({
	...inner,
	span(options) {
		const span = inner.span(options)
		return new Proxy(span, {
			get(target, property, _receiver) {
				if (property === 'attribute')
					return (key: string, value: unknown) => {
						target.attribute(key, OPAQUE_ATTRIBUTES.has(key) ? REDACTED : value)
					}
				const member = Reflect.get(target, property, target)
				// Bound to the real span: these are class methods, and calling one
				// with the proxy as `this` reaches back through this trap.
				return typeof member === 'function' ? member.bind(target) : member
			},
		})
	},
})
