// The worker's telemetry has to be handed OUT of the layer it runs on, not just
// used inside it. Kept inside, the worker starts up, prints that sending is on,
// and then sends nothing at all — with no sign but silence nobody is watching.
//
// Nothing else catches it: both spellings compile the same, because the
// exporter's own type is erased by the branch that turns sending off. Building
// the layer for real and reading what comes out is the only check there is, and
// building it for real is why this needs a database.

import { applyTestEnv } from '../test-env.js'

const ENDPOINT = 'OTEL_EXPORTER_OTLP_ENDPOINT'
const previousEndpoint = process.env[ENDPOINT]

applyTestEnv()
// Assigned outright, not defaulted: switching sending on IS the test, so an
// endpoint already in the environment must not decide the outcome. Nothing is
// ever sent — building the layer is the whole test — so the address only has to
// parse.
process.env[ENDPOINT] = 'http://127.0.0.1:4318'

import { type Context, Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'

import { Live } from './live-layer.js'

// What a built layer hands out, by name. Read from what the layer produced
// rather than looked up as a service: a lookup falls back to the built-in
// tracer and answers "yes" even when nothing came out — the exact failure this
// test exists to catch.
const handedOut = (context: Context.Context<never>): ReadonlyArray<string> =>
	[...context.mapUnsafe.keys()].sort()

describe('the layer the worker loop runs on', () => {
	afterAll(() => {
		if (previousEndpoint === undefined) delete process.env[ENDPOINT]
		else process.env[ENDPOINT] = previousEndpoint
	})

	describe('when exporting is switched on', () => {
		it('should hand out the tracer and the logger, not keep them inside', async () => {
			// GIVEN the layer built the way the worker builds it
			const names = handedOut(
				await Effect.runPromise(Effect.scoped(Layer.build(Live))),
			)

			// THEN a tracer and a logger are among what came out — matched loosely,
			// so a rename inside the library cannot quietly make this a test that
			// proves nothing. Kept inside instead, the worker would look healthy and
			// report nothing.
			expect(names.some(name => /Tracer/i.test(name))).toBe(true)
			expect(names.some(name => /Logger/i.test(name))).toBe(true)

			// AND what the loop itself needs still comes out alongside it
			expect(names).toContain('WorkerEnvVars')
		})
	})
})
