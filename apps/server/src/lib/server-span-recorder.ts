import { Effect, Layer, Tracer } from 'effect'

/**
 * A tracer for tests that notes the name of every span the server opens for an
 * incoming request, in the order they opened, and passes everything through.
 * `names` is shared and never reset here, so each case clears it first.
 */
export const serverSpanRecorder = () => {
	const names: Array<string> = []
	const layer = Layer.effect(Tracer.Tracer)(
		Effect.map(
			Effect.service(Tracer.Tracer),
			(inner): Tracer.Tracer => ({
				...inner,
				span(options) {
					if (options.kind === 'server') names.push(options.name)
					return inner.span(options)
				},
			}),
		),
	)
	return { names, layer }
}
