// Covers the two things about this layer that can be got wrong without anything
// failing: how a process composes it, and whether the process notices when what
// it composed stops working.
//
// The exporter installs itself by putting a logger and a tracer into the context
// it is built into. A process that provides it without merging it back still
// boots, still says export is enabled, and still runs its own background
// flushers — but every line the process writes afterwards goes to the logger it
// already had, so nothing is ever sent. The mail-worker sat like that: alive,
// logging every few seconds, and absent from the vendor for good.
//
// The second is a backend that refuses every batch. The exporter reports that
// at Debug and both services run at Info, so the runtime drops the line before
// a logger sees it — a process that exports nothing looks like one exporting
// fine. These watch for the line that has to be written instead, and for it
// being written once rather than on every attempt.
//
// So this asserts the whole path for real, against a local sink rather than a
// vendor: compose it the way a process must, write one line, and watch the line
// leave — or watch the process say why it did not.

import { createServer, type Server } from 'node:http'

import {
	ConfigProvider,
	Duration,
	Effect,
	Layer,
	Logger,
	ManagedRuntime,
	References,
} from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { exportHealth, exportReport, makeExportHealth } from './export-health'
import { endpointOf, makeOtlpObservability } from './otlp'

const paths: Array<string> = []
let status = 200
let server: Server
let endpoint: string

const sink = () =>
	new Promise<Server>(resolve => {
		const created = createServer((request, response) => {
			request.resume()
			request.on('end', () => {
				if (request.url !== undefined) paths.push(request.url)
				response.writeHead(status, { 'content-type': 'application/json' })
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

/** Keeps every line the process writes, with the `event` it was tagged with. */
const recorder = () => {
	const lines: Array<{
		readonly event: unknown
		readonly level: string
		readonly annotations: Readonly<Record<string, unknown>>
	}> = []
	const logger = Logger.make<unknown, void>(options => {
		const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
		lines.push({
			event: annotations['event'],
			level: options.logLevel,
			annotations,
		})
	})
	return { lines, layer: Logger.layer([logger]) }
}

const events = <Line extends { readonly event: unknown }>(
	lines: ReadonlyArray<Line>,
	event: string,
): ReadonlyArray<Line> => lines.filter(line => line.event === event)

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/**
 * Every value reported about every signal, flattened. A logger is handed its
 * annotations as `unknown`, so the shape is checked rather than asserted —
 * anything that is not the nested record this expects flattens to nothing, and
 * the count the caller checks fails instead of passing on a wrong shape.
 */
const reportedValues = (signals: unknown): ReadonlyArray<unknown> =>
	isRecord(signals)
		? Object.values(signals).flatMap(detail =>
				isRecord(detail) ? Object.values(detail) : [detail],
			)
		: []

// Short enough that a test does not wait out a real interval. `failingAfter` is
// zero so the first check after a refused batch is enough; the heartbeat is
// pushed out of the way except where it is the thing being asserted.
const brisk = {
	requestTimeout: Duration.seconds(2),
	checkEvery: Duration.millis(100),
	failingAfter: Duration.zero,
	heartbeatEvery: Duration.minutes(10),
}

describe('naming the endpoint on a log line', () => {
	describe('when the endpoint carries a path', () => {
		it('should keep it, because a wrong path is what this line is for', () => {
			// GIVEN a backend reached below a path
			// THEN the path survives, so a wrong one is visible
			expect(endpointOf('https://api.eu1.honeycomb.io/otlp')).toBe(
				'https://api.eu1.honeycomb.io/otlp',
			)
		})
	})

	describe('when the endpoint carries a query string', () => {
		it('should drop it, since that is where a key would hide', () => {
			// GIVEN a backend that takes its key in the URL rather than a header
			// THEN nothing after the path is written down
			expect(
				endpointOf('https://collector.example.com/v1?api-key=sekrit'),
			).toBe('https://collector.example.com/v1')
		})
	})

	describe('when the endpoint cannot be parsed', () => {
		it('should say so without repeating it back', () => {
			// GIVEN a setting that is not a URL at all
			const named = endpointOf('not a url ?key=sekrit')

			// THEN the line reports the problem and none of the value
			expect(named).toContain('unparseable')
			expect(named).not.toContain('sekrit')
		})
	})
})

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
			status = 200

			// WHEN the process writes a line
			await runtime.runPromise(Effect.logInfo('a line worth exporting'))
			// Shutting down flushes what is still batched, so the test does not wait
			// on an export interval.
			await runtime.dispose()

			// THEN the line reaches the endpoint
			expect(await reached('/v1/logs', 5_000)).toBe(true)
			// AND the process's own record says it is exporting, which is what the
			//     health check reads — this build passed no record of its own, so
			//     this is the one the deployed processes use
			expect(exportReport(exportHealth, Date.now()).exporting).toBe(true)
		}, 30_000)
	})

	describe('when the backend refuses every batch', () => {
		it('should say so once, not once per attempt', async () => {
			// GIVEN a backend answering 401 to everything
			const log = recorder()
			const runtime = ManagedRuntime.make(
				Layer.empty.pipe(
					Layer.provideMerge(
						makeOtlpObservability({
							serviceName: 'observability-test',
							cadence: brisk,
							health: makeExportHealth(),
						}),
					),
					Layer.provide(log.layer),
				),
			)
			paths.length = 0
			status = 401

			try {
				// WHEN the process writes lines for long enough that batches go out and
				//      are refused
				await runtime.runPromise(Effect.logInfo('one'))
				await settle(1_500)
				await runtime.runPromise(Effect.logInfo('two'))
				await settle(1_500)

				// THEN it complained exactly once, however many batches were refused
				expect(events(log.lines, 'otlp.export.failing')).toHaveLength(1)
				// AND loudly enough to survive a production log level
				expect(events(log.lines, 'otlp.export.failing')[0]?.level).toBe('Error')
				// AND what it says about each signal carries no empty field: the
				//     console formatter prints those as the word `undefined`, which
				//     is not something a reader can parse back
				const values = reportedValues(
					events(log.lines, 'otlp.export.failing')[0]?.annotations['signals'],
				)
				expect(values.length).toBeGreaterThan(0)
				expect(values).not.toContain(undefined)
			} finally {
				await runtime.dispose()
			}
		}, 30_000)
	})

	describe('when export breaks and later comes back', () => {
		// The health record is driven by hand here rather than through the sink:
		// the exporter stops trying for a full minute after a refused batch, so a
		// test that waited for it to retry would have to wait that minute out. What
		// is under test is the watchdog's reading of the record, which is the part
		// that decides whether anything gets said at all.
		it('should say each of those exactly once', async () => {
			// GIVEN a process whose export health the test drives directly
			const log = recorder()
			const health = makeExportHealth()
			const runtime = ManagedRuntime.make(
				Layer.empty.pipe(
					Layer.provideMerge(
						makeOtlpObservability({
							serviceName: 'observability-test',
							cadence: brisk,
							health,
						}),
					),
					Layer.provide(log.layer),
				),
			)
			paths.length = 0
			status = 200

			try {
				await runtime.runPromise(Effect.void)

				// WHEN export starts failing, and keeps failing
				health.recordFailure('traces', 'unauthorized', 401, Date.now())
				await settle(400)
				health.recordFailure('traces', 'unauthorized', 401, Date.now())
				await settle(400)

				// THEN it was reported once, not once per failure
				expect(events(log.lines, 'otlp.export.failing')).toHaveLength(1)
				expect(events(log.lines, 'otlp.export.recovered')).toHaveLength(0)

				// WHEN a batch is accepted again
				health.recordSuccess('traces', Date.now())
				await settle(400)

				// THEN the recovery is announced once, and the complaint is not
				//      repeated
				expect(events(log.lines, 'otlp.export.recovered')).toHaveLength(1)
				expect(events(log.lines, 'otlp.export.failing')).toHaveLength(1)
			} finally {
				await runtime.dispose()
			}
		}, 30_000)
	})

	describe('when the process has nothing to export', () => {
		it('should stay quiet rather than report the silence as a failure', async () => {
			// GIVEN a healthy backend and a process that writes nothing — the state
			//       every service is in overnight
			const log = recorder()
			const runtime = ManagedRuntime.make(
				Layer.empty.pipe(
					Layer.provideMerge(
						makeOtlpObservability({
							serviceName: 'observability-test',
							cadence: brisk,
							health: makeExportHealth(),
						}),
					),
					Layer.provide(log.layer),
				),
			)
			paths.length = 0
			status = 200

			try {
				// WHEN it sits idle for longer than several export intervals
				await settle(2_000)

				// THEN nothing was posted on the signals that skip an empty batch —
				//      the reason a test for staleness would call this broken
				expect(paths).not.toContain('/v1/traces')
				// AND the process did not complain
				expect(events(log.lines, 'otlp.export.failing')).toHaveLength(0)
			} finally {
				await runtime.dispose()
			}
		}, 30_000)
	})

	describe('when no endpoint is configured', () => {
		// A config provider rather than an edit to `process.env`: the default
		// provider copies the environment once, the first time anything reads
		// config, so a variable set part-way through a run is never seen.
		const withEnv = (
			env: Record<string, string>,
			log: ReturnType<typeof recorder>,
		) =>
			ManagedRuntime.make(
				Layer.empty.pipe(
					Layer.provideMerge(
						makeOtlpObservability({
							serviceName: 'observability-test',
							cadence: { ...brisk, heartbeatEvery: Duration.millis(200) },
							// Its own record, so building a layer with export off here
							// cannot leave the process-wide one saying so for whichever
							// test runs next.
							health: makeExportHealth(),
						}),
					),
					Layer.provide(log.layer),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
				),
			)

		it('should be loud about it in production, and still report its state', async () => {
			// GIVEN production with the endpoint missing from the baked config
			const log = recorder()
			const runtime = withEnv({ NODE_ENV: 'production' }, log)

			try {
				// WHEN the layer is built and left to run
				await runtime.runPromise(Effect.void)
				await settle(500)

				// THEN it said so at a level a production log level keeps
				expect(log.lines.some(line => line.level === 'Error')).toBe(true)
				// AND it keeps repeating that it exports nothing, so the answer is
				//     still there to read later
				expect(events(log.lines, 'otlp.export.health').length).toBeGreaterThan(
					0,
				)
			} finally {
				await runtime.dispose()
			}
		}, 30_000)

		it('should stay quiet about it outside production', async () => {
			// GIVEN local development with no endpoint set
			const log = recorder()
			const runtime = withEnv({ NODE_ENV: 'development' }, log)

			try {
				// WHEN the layer is built
				await runtime.runPromise(Effect.void)
				await settle(300)

				// THEN export being off is ordinary news, not an error
				expect(log.lines.some(line => line.level === 'Error')).toBe(false)
			} finally {
				await runtime.dispose()
			}
		}, 30_000)
	})
})
