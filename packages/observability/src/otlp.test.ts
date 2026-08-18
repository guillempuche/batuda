// Covers the one thing about this layer that can be got wrong without anything
// failing: how a process composes it.
//
// The exporter installs itself by putting a logger and a tracer into the context
// it is built into. A process that provides it without merging it back still
// boots, still says export is enabled, and still runs its own background
// flushers — but every line the process writes afterwards goes to the logger it
// already had, so nothing is ever sent. The mail-worker sat like that: alive,
// logging every few seconds, and absent from the vendor for good.
//
// So this asserts the whole path for real, against a local sink rather than a
// vendor: compose it the way a process must, write one line, and watch the line
// leave.

import { createServer, type Server } from 'node:http'

import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { makeOtlpObservability } from './otlp'

const paths: Array<string> = []
let server: Server
let endpoint: string

const sink = () =>
	new Promise<Server>(resolve => {
		const created = createServer((request, response) => {
			request.resume()
			request.on('end', () => {
				if (request.url !== undefined) paths.push(request.url)
				response.writeHead(200, { 'content-type': 'application/json' })
				response.end('{}')
			})
		})
		created.listen(0, '127.0.0.1', () => resolve(created))
	})

const reached = async (path: string, within: number) => {
	const deadline = Date.now() + within
	while (Date.now() < deadline) {
		if (paths.includes(path)) return true
		await new Promise(resolve => setTimeout(resolve, 50))
	}
	return paths.includes(path)
}

describe('the OTLP observability layer', () => {
	beforeAll(async () => {
		server = await sink()
		const address = server.address()
		if (address === null || typeof address === 'string')
			throw new Error('expected a TCP address for the sink')
		endpoint = `http://127.0.0.1:${address.port}`
		// Read by the layer as it builds, so it has to be set before that happens.
		process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = endpoint
	}, 30_000)

	afterAll(async () => {
		delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
		// The exporter's client keeps its socket alive, and `close` on its own waits
		// for open sockets — which would hang teardown rather than fail it.
		server.closeAllConnections()
		await new Promise(resolve => server.close(resolve))
	})

	describe('when a process merges it into the layer it runs on', () => {
		it('should send the lines that process writes', async () => {
			// GIVEN the layer composed the way a process has to compose it: merged
			//       back, so what the process runs on carries the exporter's logger
			const Live = Layer.empty.pipe(
				Layer.provideMerge(
					makeOtlpObservability({ serviceName: 'observability-test' }),
				),
			)
			const runtime = ManagedRuntime.make(Live)
			paths.length = 0

			// WHEN the process writes a line
			await runtime.runPromise(Effect.logInfo('a line worth exporting'))
			// Shutting down flushes what is still batched, so the test does not wait
			// on an export interval.
			await runtime.dispose()

			// THEN the line reaches the endpoint
			expect(await reached('/v1/logs', 5_000)).toBe(true)
		}, 30_000)
	})
})
